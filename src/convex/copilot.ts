import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { ROLES } from "./schema";
import {
  API_KEY_ENV_VAR,
  BRIEF_TOOL,
  DEFAULT_MODEL,
  MODEL_ENV_VAR,
  SYSTEM_PROMPT,
  buildSourceText,
  groundClaims,
  hashSource,
  normalizeForGrounding,
  sanitizeCriteria,
  type CopilotOutput,
  type ProjectBrief,
} from "./lib/copilot";

/**
 * AI Judge Copilot.
 *
 * What lives here can produce evidence, summaries and questions. What cannot
 * live here is a score: this module contains no reference to the `scores`
 * table at all, and `lib/audit` plus the schema keep generated output in its
 * own table. The strongest version of "the AI never assigns a score" is the one
 * where the code has no ability to.
 *
 * Access follows exactly the same rules as the rest of the judge workspace:
 * you must have an assignment, and a declared conflict of interest removes it.
 */

const MAX_SOURCE_CHARS = 24_000;

function isJudgeAssigned(
  ctx: any,
  judgeId: Id<"users">,
  teamId: Id<"teams">,
): Promise<boolean> {
  return ctx.db
    .query("assignments")
    .withIndex("by_judge_team", (q: any) =>
      q.eq("judgeId", judgeId).eq("teamId", teamId),
    )
    .first()
    .then((row) => row !== null);
}

async function hasConflict(
  ctx: any,
  judgeId: Id<"users">,
  teamId: Id<"teams">,
): Promise<boolean> {
  const row = await ctx.db
    .query("judgeConflicts")
    .withIndex("by_judge_team", (q: any) =>
      q.eq("judgeId", judgeId).eq("teamId", teamId),
    )
    .first();
  return row !== null;
}

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
      .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
      .first();

    if (!brief) return { state: "missing" as const, brief: null };

    return {
      state: brief.status,
      error: brief.error ?? null,
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
// Generate
// ---------------------------------------------------------------------------

export const generate = action({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args): Promise<{ ok: boolean; error?: string }> => {
    const user = await requireRole(ctx, ROLES.JUDGE, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { ok: false, error: "No hackathon is currently active." };

    // Re-checked inside the action, not just in the query above: the action runs
    // in a different context and must stand on its own.
    if (user.role === ROLES.JUDGE) {
      if (!(await isJudgeAssigned(ctx, user._id, args.teamId))) {
        return { ok: false, error: "You are not assigned to this team." };
      }
      if (await hasConflict(ctx, user._id, args.teamId)) {
        return {
          ok: false,
          error:
            "You have been stood down from this submission due to a declared conflict of interest.",
        };
      }
    }

    const apiKey = process.env[API_KEY_ENV_VAR];
    if (!apiKey) {
      const message = `No AI key is configured. Add ${API_KEY_ENV_VAR} in the project's Keys settings and try again.`;
      await ctx.runMutation(internal.saveFailedBrief, {
        hackathonId: hackathon._id,
        teamId: args.teamId,
        error: message,
      });
      return { ok: false, error: message };
    }

    const model = process.env[MODEL_ENV_VAR] || DEFAULT_MODEL;

    const submission = await ctx.runQuery(internal.submissionSource, {
      teamId: args.teamId,
    });
    if (!submission) {
      return { ok: false, error: "This team has no submission to analyse yet." };
    }

    const criteria = await ctx.runQuery(internal.criterionNames, {
      hackathonId: hackathon._id,
    });

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

    const userPrompt = `JUDGING CRITERIA (use these EXACT names as keys in \`criteria\`):
${criterionLines}

SUBMISSION TEXT (this is the ONLY source of information you have; attached documents are listed by name only and their contents were NOT provided):
<submission>
${sourceText}
</submission>

Produce the brief and one \`criteria\` entry per criterion above.`;

    let parsed: unknown;
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          tools: [BRIEF_TOOL],
          // Force the model to use the tool rather than reply in prose.
          tool_choice: { type: "tool", name: BRIEF_TOOL.name },
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        // Surface the provider's own message; a bad model id or a missing key
        // should be diagnosable from the judge's error state.
        const message = `The AI service returned ${response.status}: ${detail.slice(0, 300)}`;
        await ctx.runMutation(internal.saveFailedBrief, {
          hackathonId: hackathon._id,
          teamId: args.teamId,
          error: message,
        });
        return { ok: false, error: message };
      }

      const payload = (await response.json()) as {
        content?: { type: string; name?: string; input?: unknown }[];
      };
      const toolUse = payload.content?.find(
        (block) => block.type === "tool_use" && block.name === BRIEF_TOOL.name,
      );
      if (!toolUse?.input) {
        const message = "The AI service did not return a usable analysis.";
        await ctx.runMutation(internal.saveFailedBrief, {
          hackathonId: hackathon._id,
          teamId: args.teamId,
          error: message,
        });
        return { ok: false, error: message };
      }
      parsed = toolUse.input;
    } catch (error) {
      const message = `Could not reach the AI service: ${
        error instanceof Error ? error.message : String(error)
      }`;
      await ctx.runMutation(internal.saveFailedBrief, {
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

    const innovation = groundClaims(rawBrief.innovationIndicators, sourceNormalized, 5);
    const impact = groundClaims(rawBrief.impactIndicators, sourceNormalized, 5);
    const implementation = groundClaims(
      rawBrief.implementationIndicators,
      sourceNormalized,
      5,
    );
    const { criteria: sanitizedCriteria, dropped: criteriaDropped } = sanitizeCriteria(
      raw.criteria,
      criteria.map((c) => c.name),
      sourceNormalized,
    );

    const brief: ProjectBrief = {
      executiveSummary: (rawBrief.executiveSummary ?? "").toString().slice(0, 2000),
      problemSummary: (rawBrief.problemSummary ?? "").toString().slice(0, 2000),
      solution: (rawBrief.solution ?? "").toString().slice(0, 2000),
      targetUsers: (rawBrief.targetUsers ?? "").toString().slice(0, 2000),
      keyFeatures: cleanStrings(rawBrief.keyFeatures),
      techStack: cleanStrings(rawBrief.techStack),
      architectureSummary: (rawBrief.architectureSummary ?? "")
        .toString()
        .slice(0, 2000),
      innovationIndicators: innovation.verified,
      impactIndicators: impact.verified,
      implementationIndicators: implementation.verified,
      missingInformation: cleanStrings(rawBrief.missingInformation, 8, 400),
    };

    const droppedUnverified =
      innovation.dropped + impact.dropped + implementation.dropped + criteriaDropped;

    const result: CopilotOutput = { brief, criteria: sanitizedCriteria };

    await ctx.runMutation(internal.saveBrief, {
      hackathonId: hackathon._id,
      submissionId: submission.submissionId,
      teamId: args.teamId,
      model,
      inputHash: hashSource(sourceText),
      droppedUnverified,
      result,
    });

    return { ok: true, droppedUnverified };
  },
});

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 10);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export const internal = {
  /** The submission fields the copilot is allowed to read. */
  submissionSource: internalMutation({
    args: { teamId: v.id("teams") },
    handler: async (ctx, args) => {
      const submission = await ctx.db
        .query("submissions")
        .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
        .unique();
      if (!submission) return null;

      const [team, files] = await Promise.all([
        ctx.db.get(args.teamId),
        ctx.db
          .query("submissionFiles")
          .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
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
  }),

  criterionNames: internalMutation({
    args: { hackathonId: v.id("hackathons") },
    handler: async (ctx, args) => {
      const rows = await ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q: any) =>
          q.eq("hackathonId", args.hackathonId),
        )
        .collect();
      return rows
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ name: c.name, description: c.description }));
    },
  }),

  /**
   * Persist a verified brief. Any previous brief for the same team is replaced,
   * so a regeneration never leaves two contradictory analyses in place.
   *
   * Note what this mutation does NOT do: it never touches `scores`.
   */
  saveBrief: internalMutation({
    args: {
      hackathonId: v.id("hackathons"),
      submissionId: v.id("submissions"),
      teamId: v.id("teams"),
      model: v.string(),
      inputHash: v.string(),
      droppedUnverified: v.number(),
      result: v.any(),
    },
    handler: async (ctx, args) => {
      for (const existing of await ctx.db
        .query("judgingBriefs")
        .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
        .collect()) {
        await ctx.db.delete(existing._id);
      }

      const result = args.result as CopilotOutput;
      const briefDoc: Doc<"judgingBriefs"> = {
        hackathonId: args.hackathonId,
        submissionId: args.submissionId,
        teamId: args.teamId,
        status: "ready" as const,
        model: args.model,
        brief: result.brief,
        criteria: result.criteria,
        generatedAt: Date.now(),
        droppedUnverified: args.droppedUnverified,
        inputHash: args.inputHash,
      };
      return await ctx.db.insert("judgingBriefs", briefDoc);
    },
  }),

  /** Record a failure so the judge sees why, with a retry, instead of a blank. */
  saveFailedBrief: internalMutation({
    args: {
      hackathonId: v.id("hackathons"),
      teamId: v.id("teams"),
      error: v.string(),
    },
    handler: async (ctx, args) => {
      const submission = await ctx.db
        .query("submissions")
        .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
        .unique();
      // No submission means there is nothing to analyse and nothing to retry,
      // so the action reports that directly instead of storing a stub.
      if (!submission) return null;

      for (const existing of await ctx.db
        .query("judgingBriefs")
        .withIndex("by_team", (q: any) => q.eq("teamId", args.teamId))
        .collect()) {
        await ctx.db.delete(existing._id);
      }

      return await ctx.db.insert("judgingBriefs", {
        hackathonId: args.hackathonId,
        submissionId: submission._id,
        teamId: args.teamId,
        status: "failed" as const,
        error: args.error,
        model: process.env[MODEL_ENV_VAR] || DEFAULT_MODEL,
        criteria: {},
        generatedAt: Date.now(),
        droppedUnverified: 0,
        inputHash: "",
      });
    },
  }),
};
