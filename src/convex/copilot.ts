import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { ROLES } from "./schema";
import {
  actionUser,
  judgeAccess,
  isJudgeAssigned,
  hasConflict,
  type ActionUser,
} from "./lib/actionAuth";
import { AIProviderError, getAIProvider, type ChatTurn } from "./lib/aiProvider";
import {
  CHAT_SCHEMA,
  CHAT_SYSTEM_PROMPT,
  DEFAULT_MODEL,
  MODEL_ENV_VAR,
  PROVIDER_NAME,
  SYSTEM_PROMPT,
  buildBriefSchema,
  buildSourceText,
  cleanStrings,
  groundClaims,
  groundQuotes,
  hashSource,
  normalizeForGrounding,
  sanitizeCriteria,
  type CopilotOutput,
  type ProjectBrief,
} from "./lib/copilot";

/**
 * AI Judge Copilot — server-side AI service layer.
 *
 * Flow: Judge UI → this action → `AIProvider` (Gemini REST, key held only in
 * the server environment) → structured JSON → verbatim grounding check →
 * `judgingBriefs` table → judge UI. No UI component ever talks to the AI
 * vendor or sees the key; they only call these Convex functions.
 *
 * What lives here can produce evidence, summaries and questions. What cannot
 * live here is a score: this module contains no reference to the `scores`
 * table at all, and the schema keeps generated output in its own table. The
 * strongest version of "the AI never assigns a score" is the one where the
 * code has no ability to.
 *
 * Access follows exactly the same rules as the rest of the judge workspace:
 * you must have an assignment, and a declared conflict of interest removes it.
 */

const MAX_SOURCE_CHARS = 24_000;
const MAX_CHAT_HISTORY = 8;
const MAX_ANSWER_CHARS = 4_000;

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------
// Authorization lives in lib/actionAuth (shared with the GitHub analyzer):
// sessionUser / currentHackathonMeta / assignmentAccess internal queries and
// the actionUser / judgeAccess / isJudgeAssigned / hasConflict helpers.
// They are imported at the top of this file.

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const briefForSubmission = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ROLES.JUDGE, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return null;

    if (user.role === ROLES.JUDGE) {
      if (!(await isJudgeAssigned(ctx, user._id, args.teamId))) {
        throw new Error("You are not assigned to this team.");
      }
      if (await hasConflict(ctx, user._id, args.teamId)) {
        throw new Error(
          "You have been stood down from this submission due to a declared conflict of interest.",
        );
      }
    }

    const brief = await ctx.db
      .query("judgingBriefs")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .first();

    if (!brief) return { state: "missing" as const, brief: null };

    return {
      state: brief.status,
      error: brief.error ?? null,
      provider: brief.provider,
      model: brief.model,
      generatedAt: brief.generatedAt,
      droppedUnverified: brief.droppedUnverified,
      inputHash: brief.inputHash,
      brief: brief.brief ?? null,
      criteria: brief.criteria,
    };
  },
});

// ---------------------------------------------------------------------------
// Generate (submission analysis)
// ---------------------------------------------------------------------------

/** Normalize the raw brief object the model returned into stored shape. */
function briefFromRaw(
  rawBrief: Record<string, unknown>,
  sourceNormalized: string,
): { brief: ProjectBrief; dropped: number } {
  const innovation = groundClaims(rawBrief.innovationIndicators, sourceNormalized, 5);
  const impact = groundClaims(rawBrief.impactIndicators, sourceNormalized, 5);
  const implementation = groundClaims(
    rawBrief.implementationIndicators,
    sourceNormalized,
    5,
  );

  const brief: ProjectBrief = {
    executiveSummary: (rawBrief.executiveSummary ?? "").toString().slice(0, 2000),
    problemSummary: (rawBrief.problemSummary ?? "").toString().slice(0, 2000),
    solution: (rawBrief.solution ?? "").toString().slice(0, 2000),
    targetUsers: (rawBrief.targetUsers ?? "").toString().slice(0, 2000),
    keyFeatures: cleanStrings(rawBrief.keyFeatures, 10, 400),
    techStack: cleanStrings(rawBrief.techStack, 15, 100),
    architectureSummary: (rawBrief.architectureSummary ?? "")
      .toString()
      .slice(0, 2000),
    innovationIndicators: innovation.verified,
    impactIndicators: impact.verified,
    implementationIndicators: implementation.verified,
    missingInformation: cleanStrings(rawBrief.missingInformation, 8, 400),
  };

  return {
    brief,
    dropped: innovation.dropped + impact.dropped + implementation.dropped,
  };
}

export const generate = action({
  args: { teamId: v.id("teams") },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; error?: string; droppedUnverified?: number }> => {
    const auth = await actionUser(ctx);
    if (!auth.ok) return { ok: false, error: auth.error };
    const user = auth.user;

    const hackathon = await ctx.runQuery(
      internal.lib.actionAuth.currentHackathonMeta,
      {},
    );
    if (!hackathon) {
      return { ok: false, error: "No hackathon is currently active." };
    }

    // Re-checked inside the action, not just in the read query above: the
    // action runs in a different context and must stand on its own.
    const accessError = await judgeAccess(ctx, user, args.teamId);
    if (accessError) return { ok: false, error: accessError };

    const submission = await ctx.runQuery(internal.copilot.submissionSource, {
      teamId: args.teamId,
    });
    if (!submission) {
      return { ok: false, error: "This team has no submission to analyse yet." };
    }

    // Resolve the provider through the abstraction. A missing/invalid key is a
    // configuration problem, recorded as a failed brief so the judge sees the
    // reason and a retry rather than a blank space.
    let provider;
    try {
      provider = getAIProvider();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The AI service is not configured.";
      await ctx.runMutation(internal.copilot.saveFailedBrief, {
        hackathonId: hackathon._id,
        teamId: args.teamId,
        error: message,
      });
      return { ok: false, error: message };
    }

    const criteria = await ctx.runQuery(internal.copilot.criterionNames, {
      hackathonId: hackathon._id,
    });
    if (criteria.length === 0) {
      return {
        ok: false,
        error: "No judging criteria are configured for this hackathon.",
      };
    }

    // The source text is truncated to a hard ceiling BEFORE it is hashed, so
    // the hash describes exactly what the model saw.
    const sourceText = buildSourceText(
      {
        projectName: submission.projectName,
        techStack: submission.techStack,
        problemStatement: submission.problemStatement,
        solutionDescription: submission.solutionDescription,
        targetUsers: submission.targetUsers,
        keyFeatures: submission.keyFeatures,
        innovation: submission.innovation,
        expectedImpact: submission.expectedImpact,
        implementationDetails: submission.implementationDetails,
        futureScope: submission.futureScope,
        abstract: submission.abstract,
        documentNames: submission.documentNames,
      },
      hackathon.blindJudging,
    ).slice(0, MAX_SOURCE_CHARS);

    const criterionLines = criteria
      .map((c) => `- "${c.name}": ${c.description}`)
      .join("\n");

    const userPrompt = `JUDGING CRITERIA (use these EXACT names as the \`criterion\` value of each \`criteria\` entry):
${criterionLines}

SUBMISSION TEXT (this is the ONLY source of information you have; attached documents are listed by name only and their contents were NOT provided):
<submission>
${sourceText}
</submission>

Produce the brief and one \`criteria\` entry for EVERY criterion listed above.`;

    let parsed: unknown;
    let providerName: string;
    let modelUsed: string;
    try {
      const result = await provider.generateStructured({
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        schema: buildBriefSchema(criteria.map((c) => c.name)),
        schemaName: "judging_brief",
        schemaDescription:
          "Structured, evidence-grounded analysis of one hackathon submission.",
      });
      parsed = result.parsed;
      providerName = result.provider;
      modelUsed = result.model;
    } catch (error) {
      const message =
        error instanceof AIProviderError
          ? error.message
          : `Could not reach the AI service: ${
              error instanceof Error ? error.message : String(error)
            }`;
      await ctx.runMutation(internal.copilot.saveFailedBrief, {
        hackathonId: hackathon._id,
        teamId: args.teamId,
        error: message,
      });
      return { ok: false, error: message };
    }

    // --- Verification -----------------------------------------------------
    // Everything below is the trust boundary. The model has had its say; what
    // gets stored is only what can be traced back to the submission text.
    const sourceNormalized = normalizeForGrounding(sourceText);
    const raw = (parsed ?? {}) as Record<string, unknown>;
    const rawBrief = (raw.brief ?? {}) as Record<string, unknown>;

    const { brief, dropped: briefDropped } = briefFromRaw(rawBrief, sourceNormalized);
    const { criteria: sanitizedCriteria, dropped: criteriaDropped } =
      sanitizeCriteria(
        raw.criteria,
        criteria.map((c) => c.name),
        sourceNormalized,
      );

    const droppedUnverified = briefDropped + criteriaDropped;
    const result: CopilotOutput = { brief, criteria: sanitizedCriteria };

    await ctx.runMutation(internal.copilot.saveBrief, {
      hackathonId: hackathon._id,
      submissionId: submission.submissionId,
      teamId: args.teamId,
      provider: providerName,
      model: modelUsed,
      inputHash: hashSource(sourceText),
      droppedUnverified,
      result,
    });

    return { ok: true, droppedUnverified };
  },
});

// ---------------------------------------------------------------------------
// Chat about the current submission
// ---------------------------------------------------------------------------

export const chat = action({
  args: {
    teamId: v.id("teams"),
    message: v.string(),
    history: v.optional(
      v.array(
        v.object({
          role: v.union(v.literal("user"), v.literal("model")),
          text: v.string(),
        }),
      ),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        ok: true;
        answer: string;
        quotes: string[];
        notInSource: boolean;
        dropped: number;
      }
    | { ok: false; error: string }
  > => {
    const auth = await actionUser(ctx);
    if (!auth.ok) return { ok: false, error: auth.error };
    const user = auth.user;

    const question = args.message.trim().slice(0, 2000);
    if (!question) {
      return { ok: false, error: "Ask a question about the submission first." };
    }

    const hackathon = await ctx.runQuery(
      internal.lib.actionAuth.currentHackathonMeta,
      {},
    );
    if (!hackathon) {
      return { ok: false, error: "No hackathon is currently active." };
    }

    const accessError = await judgeAccess(ctx, user, args.teamId);
    if (accessError) return { ok: false, error: accessError };

    const submission = await ctx.runQuery(internal.copilot.submissionSource, {
      teamId: args.teamId,
    });
    if (!submission) {
      return { ok: false, error: "This team has no submission to discuss yet." };
    }

    let provider;
    try {
      provider = getAIProvider();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The AI service is not configured.";
      return { ok: false, error: message };
    }

    const sourceText = buildSourceText(
      {
        projectName: submission.projectName,
        techStack: submission.techStack,
        problemStatement: submission.problemStatement,
        solutionDescription: submission.solutionDescription,
        targetUsers: submission.targetUsers,
        keyFeatures: submission.keyFeatures,
        innovation: submission.innovation,
        expectedImpact: submission.expectedImpact,
        implementationDetails: submission.implementationDetails,
        futureScope: submission.futureScope,
        abstract: submission.abstract,
        documentNames: submission.documentNames,
      },
      hackathon.blindJudging,
    ).slice(0, MAX_SOURCE_CHARS);

    // Cap and clean the client-supplied history: the model sees only recent,
    // bounded turns, and nothing the client sent can change the source text.
    const history: ChatTurn[] = (args.history ?? [])
      .slice(-MAX_CHAT_HISTORY)
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

    try {
      const result = await provider.generateStructured({
        system: `${CHAT_SYSTEM_PROMPT}\n\nSUBMISSION TEXT (the ONLY source of information you have):\n<submission>\n${sourceText}\n</submission>`,
        prompt: question,
        schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "judge_chat_answer",
        schemaDescription: "A grounded answer about one hackathon submission.",
        history,
      });

      const raw = (result.parsed ?? {}) as Record<string, unknown>;
      const notInSource = raw.notInSource === true;
      const answer = (raw.answer ?? "").toString().slice(0, MAX_ANSWER_CHARS);

      // Same trust boundary as the brief: quotes must be verbatim in the
      // source text, or they are discarded (and counted). If the model says
      // the answer is not in the source, any quotes it produced are dropped
      // along with the claim.
      const sourceNormalized = normalizeForGrounding(sourceText);
      const grounded = notInSource
        ? { verified: [], dropped: 0 }
        : groundQuotes(raw.quotes, sourceNormalized, 5);

      return {
        ok: true,
        answer,
        quotes: grounded.verified,
        notInSource,
        dropped: grounded.dropped,
      };
    } catch (error) {
      const message =
        error instanceof AIProviderError
          ? error.message
          : `Could not reach the AI service: ${
              error instanceof Error ? error.message : String(error)
            }`;
      return { ok: false, error: message };
    }
  },
});

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The submission fields the copilot is allowed to read. */
export const submissionSource = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    if (!submission) return null;

    const [team, files] = await Promise.all([
      ctx.db.get(args.teamId),
      ctx.db
        .query("submissionFiles")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
    ]);

    return {
      submissionId: submission._id as Id<"submissions">,
      projectName: team?.projectName ?? "",
      techStack: team?.techStack ?? [],
      problemStatement: submission.problemStatement ?? null,
      solutionDescription: submission.solutionDescription ?? null,
      targetUsers: submission.targetUsers ?? null,
      keyFeatures: submission.keyFeatures ?? [],
      innovation: submission.innovation ?? null,
      expectedImpact: submission.expectedImpact ?? null,
      implementationDetails: submission.implementationDetails ?? null,
      futureScope: submission.futureScope ?? null,
      abstract: submission.abstract ?? null,
      documentNames: files.map((f) => f.fileName),
    };
  },
});

export const criterionNames = internalQuery({
  args: { hackathonId: v.id("hackathons") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", args.hackathonId))
      .collect();
    return rows
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ name: c.name, description: c.description }));
  },
});

/**
 * Persist a verified brief. Any previous brief for the same team is replaced,
 * so a regeneration never leaves two contradictory analyses in place.
 *
 * Note what this mutation does NOT do: it never touches `scores`.
 */
export const saveBrief = internalMutation({
  args: {
    hackathonId: v.id("hackathons"),
    submissionId: v.id("submissions"),
    teamId: v.id("teams"),
    provider: v.string(),
    model: v.string(),
    inputHash: v.string(),
    droppedUnverified: v.number(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    for (const existing of await ctx.db
      .query("judgingBriefs")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()) {
      await ctx.db.delete(existing._id);
    }

    const result = args.result as CopilotOutput;
    return await ctx.db.insert("judgingBriefs", {
      hackathonId: args.hackathonId,
      submissionId: args.submissionId,
      teamId: args.teamId,
      status: "ready" as const,
      provider: args.provider,
      model: args.model,
      brief: result.brief,
      criteria: result.criteria,
      generatedAt: Date.now(),
      droppedUnverified: args.droppedUnverified,
      inputHash: args.inputHash,
    });
  },
});

/** Record a failure so the judge sees why, with a retry, instead of a blank. */
export const saveFailedBrief = internalMutation({
  args: {
    hackathonId: v.id("hackathons"),
    teamId: v.id("teams"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    // No submission means there is nothing to analyse and nothing to retry,
    // so the action reports that directly instead of storing a stub.
    if (!submission) return null;

    for (const existing of await ctx.db
      .query("judgingBriefs")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()) {
      await ctx.db.delete(existing._id);
    }

    return await ctx.db.insert("judgingBriefs", {
      hackathonId: args.hackathonId,
      submissionId: submission._id,
      teamId: args.teamId,
      status: "failed" as const,
      error: args.error.slice(0, 1000),
      provider: PROVIDER_NAME,
      model: process.env[MODEL_ENV_VAR]?.trim() || DEFAULT_MODEL,
      criteria: {},
      generatedAt: Date.now(),
      droppedUnverified: 0,
      inputHash: "",
    });
  },
});
