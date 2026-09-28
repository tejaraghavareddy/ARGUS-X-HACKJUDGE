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
  PDF_TRANSCRIBE_PROMPT,
  PDF_TRANSCRIBE_SCHEMA,
  SYSTEM_PROMPT,
  assembleTranscription,
  buildBriefSchema,
  buildSourceText,
  buildCorpus,
  cleanStrings,
  groundClaims,
  groundQuotes,
  hashSource,
  type EvidenceCorpus,
  type PdfTranscription,
  type SourceDocument,
  type SourcesUsed,
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
/** Per-document ceiling for non-form corpus documents. */
const MAX_DOC_CHARS = 20_000;
/** Corpus ceiling for chat-time reuse (stored in the brief row). */
const MAX_CORPUS_CHARS = 60_000;
/** Ceiling for the stored, verbatim corpus handed to chat. */
const MAX_STORED_CORPUS_CHARS = 60_000;
/** Max uploaded files read into the corpus, in submission-file order. */
const MAX_FILES_IN_CORPUS = 8;
/** Max uploaded files sent to PDF transcription, per generation. */
const MAX_PDF_TRANSCRIPTIONS = 3;
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
      sources: brief.sources ?? [],
      corpusNotes: brief.corpusNotes ?? [],
    };
  },
});

// ---------------------------------------------------------------------------
// Generate (submission analysis)
// ---------------------------------------------------------------------------

/**
 * Transcribe an uploaded PDF with the provider's multimodal path so the text
 * becomes quotable corpus, page by page. Files that cannot be read throw and
 * are recorded as a corpus note instead of failing the generation.
 */
async function transcribePdf(
  provider: { generateStructured: (i: never) => Promise<{ parsed: unknown }> },
  pdf: { fileName: string; storageId: string },
  getUrl: (storageId: string) => Promise<string | null>,
): Promise<PdfTranscription> {
  const url = await getUrl(pdf.storageId);
  if (!url) throw new Error("no readable storage URL");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`storage fetch failed (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 15_000_000) {
    throw new Error("file too large to transcribe");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const result = await provider.generateStructured({
    system: PDF_TRANSCRIBE_PROMPT,
    prompt: `Transcribe this document (${pdf.fileName}).`,
    schema: PDF_TRANSCRIBE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "pdf_transcription",
    schemaDescription: "Page-by-page verbatim transcription of one document.",
    attachments: [{ mimeType: "application/pdf", data: btoa(binary) }],
  } as never);
  return assembleTranscription(result.parsed);
}

/** Normalize the raw brief object the model returned into stored shape. */
function briefFromRaw(
  rawBrief: Record<string, unknown>,
  corpus: EvidenceCorpus,
): { brief: ProjectBrief; dropped: number } {
  const innovation = groundClaims(rawBrief.innovationIndicators, corpus, 5);
  const impact = groundClaims(rawBrief.impactIndicators, corpus, 5);
  const implementation = groundClaims(
    rawBrief.implementationIndicators,
    corpus,
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

    // ------------------------------------------------------------------
    // Evidence corpus: every participant-provided material the model may
    // quote from. Document 0 is the structured submission form; the GitHub
    // README and repo analysis follow; uploaded documents come last (form
    // first, so it wins `resolveSource` ties).
    // ------------------------------------------------------------------
    const documents: SourceDocument[] = [];

    const formText = buildSourceText(
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
    if (formText.trim()) {
      documents.push({ sourceId: "form", source: "Project documentation", text: formText });
    }

    if (submission.githubReadme?.text) {
      documents.push({
        sourceId: "github-readme",
        source: "README (GitHub)",
        text: submission.githubReadme.text.slice(0, MAX_DOC_CHARS),
      });
    }
    if (submission.githubSummary) {
      documents.push({
        sourceId: "github-analysis",
        source: "GitHub repository analysis",
        text: submission.githubSummary.slice(0, MAX_DOC_CHARS),
      });
    }

    // Uploaded text documents, keyed to the exact file the quote came from.
    for (const file of submission.uploadedTexts ?? []) {
      if (!file.text?.trim()) continue;
      documents.push({
        sourceId: `file:${file.fileName}`,
        source: `Uploaded document — ${file.fileName}`,
        text: file.text.slice(0, MAX_DOC_CHARS),
      });
    }

    // Uploaded PDFs are transcribed by the provider (multimodal) and each
    // transcribed chunk is stored with its page range, so a quote from a PDF
    // resolves to the exact page it appeared on.
    const pdfNotes: string[] = [];
    for (const pdf of (submission.pdfDocuments ?? []).slice(0, MAX_PDF_TRANSCRIPTIONS)) {
      try {
        const transcription = await transcribePdf(provider, pdf, (storageId) =>
          ctx.storage.getUrl(storageId as unknown as Id<"_storage">),
        );
        if (transcription.text.trim()) {
          documents.push({
            sourceId: `pdf:${pdf.fileName}`,
            source: `Uploaded document (PDF) — ${pdf.fileName}`,
            text: transcription.text.slice(0, MAX_DOC_CHARS),
            pages: transcription.pages,
          });
        }
      } catch {
        // A failed transcription narrows the corpus; it never fails the run.
        pdfNotes.push(
          `${pdf.fileName} could not be transcribed, so quotes from it are unavailable`,
        );
      }
    }

    // The hashed input covers exactly what the model will see, in order.
    const sourceText = documents.map((d) => d.text).join("\n\n");

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
    // gets stored is only what can be traced back to a real document in the
    // evidence corpus, with the source (and page, when available) attached.
    const corpus = buildCorpus(documents);
    void corpus;
    const raw = (parsed ?? {}) as Record<string, unknown>;
    const rawBrief = (raw.brief ?? {}) as Record<string, unknown>;

    const { brief, dropped: briefDropped } = briefFromRaw(rawBrief, corpus);
    const { criteria: sanitizedCriteria, dropped: criteriaDropped } =
      sanitizeCriteria(
        raw.criteria,
        criteria.map((c) => c.name),
        corpus,
      );

    const droppedUnverified = briefDropped + criteriaDropped;
    const result: CopilotOutput = { brief, criteria: sanitizedCriteria };

    // Provenance: which documents the analysis was grounded in, plus notes
    // about anything that could not be read. The bounded corpus is stored so
    // chat re-uses exactly what the brief was verified against.
    const sources = documents.map((d): SourcesUsed => ({
      sourceId: d.sourceId,
      source: d.source,
      chars: d.text.length,
      ...(d.pages?.length ? { pages: d.pages.length } : {}),
    }));
    const storedCorpus = documents.map((d) => ({
      sourceId: d.sourceId,
      source: d.source,
      text: d.text.slice(0, Math.floor(MAX_STORED_CORPUS_CHARS / Math.max(documents.length, 1))),
      ...(d.pages ? { pages: d.pages } : {}),
    }));

    await ctx.runMutation(internal.copilot.saveBrief, {
      hackathonId: hackathon._id,
      submissionId: submission.submissionId,
      teamId: args.teamId,
      provider: providerName,
      model: modelUsed,
      inputHash: hashSource(sourceText),
      droppedUnverified,
      sources,
      corpusNotes: pdfNotes,
      corpus: storedCorpus,
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
        quotes: { quote: string; source: { sourceId: string; source: string; page?: number } }[];
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

    // Chat grounds in the STORED corpus from the last successful generation —
    // exactly what the brief was verified against — rather than re-fetching
    // GitHub or re-transcribing PDFs on every message.
    const briefRow = await ctx.runQuery(internal.copilot.briefRowForChat, {
      teamId: args.teamId,
    });
    if (!briefRow?.corpus?.length) {
      return {
        ok: false,
        error:
          "Generate the AI analysis first; chat grounds in that analysis's evidence corpus.",
      };
    }

    const corpus = buildCorpus(
      briefRow.corpus.map((d) => ({
        sourceId: d.sourceId,
        source: d.source,
        text: d.text,
        ...(d.pages ? { pages: d.pages } : {}),
      })),
    );

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

    // Cap and clean the client-supplied history: the model sees only recent,
    // bounded turns, and nothing the client sent can change the source text.
    const history: ChatTurn[] = (args.history ?? [])
      .slice(-MAX_CHAT_HISTORY)
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));

    try {
      const result = await provider.generateStructured({
        system: `${CHAT_SYSTEM_PROMPT}\n\nEVIDENCE CORPUS (the ONLY source of information you have; each document is labeled with its source):\n${corpus.documents
          .map(
            (d, i) =>
              `<document source="${d.source}">\n${corpus.normalized[i] ? d.text : d.text}\n</document>`,
          )
          .join("\n")}`,
        prompt: question,
        schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "judge_chat_answer",
        schemaDescription: "A grounded answer about one hackathon submission.",
        history,
      });

      const raw = (result.parsed ?? {}) as Record<string, unknown>;
      const notInSource = raw.notInSource === true;
      const answer = (raw.answer ?? "").toString().slice(0, MAX_ANSWER_CHARS);

      // Same trust boundary as the brief: quotes must be verbatim in SOME
      // document of the evidence corpus, or they are discarded (and counted).
      // Each surviving quote carries the source (and page when available) it
      // was verified against. If the model says the answer is not in the
      // source, any quotes it produced are dropped along with the claim.
      const grounded = notInSource
        ? { verified: [], dropped: 0 }
        : groundQuotes(raw.quotes, corpus, 5);

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

/**
 * The submission materials the copilot is allowed to read — the full evidence
 * corpus source list: the structured form, the GitHub README excerpt and
 * analyzer report (when a repo analysis has been run), and every uploaded
 * file (text read via storage; PDFs flagged for page-aware transcription).
 */
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

    const uploadedTexts: { fileName: string; text: string | null }[] = [];
    const pdfDocuments: { fileName: string; storageId: string }[] = [];
    for (const file of files) {
      if (file.contentType === "application/pdf") {
        pdfDocuments.push({ fileName: file.fileName, storageId: file.storageId });
      } else if (
        /^text\//.test(file.contentType) ||
        /json|markdown|csv|xml|yaml/i.test(file.contentType)
      ) {
        const blob = await ctx.storage.getUrl(file.storageId as unknown as Id<"_storage">);
        let text: string | null = null;
        try {
          const response = await fetch(blob);
          if (response.ok && (await response.arrayBuffer()).byteLength <= 2_000_000) {
            text = await response.text();
          }
        } catch {
          text = null;
        }
        uploadedTexts.push({ fileName: file.fileName, text });
      }
    }

    const repoAnalysis = await ctx.db
      .query("repoAnalyses")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .first();

    // The repo analyzer's report is participant-derived evidence too (it
    // describes THEIR repository), so it belongs in the copilot's corpus.
    const githubSummary = repoAnalysis
      ? [
          `Repository: ${repoAnalysis.repoFullName ?? "unknown"}.`,
          ...repoAnalysis.sections.map((section) =>
            section.noEvidence
              ? `${section.title}: supporting evidence was not identified in the analyzed repository.`
              : `${section.title}: ${section.evidence
                  .map((e) => `${e.label} (source: ${e.source})`)
                  .join("; ")}`, 
          ),
          `README excerpt: ${repoAnalysis.readmeExcerpt ?? "not retrieved"}.`,
        ].join("\n")
      : null;

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
      githubReadme: repoAnalysis?.readmeExcerpt
        ? { text: repoAnalysis.readmeExcerpt }
        : null,
      githubSummary,
      uploadedTexts,
      pdfDocuments,
    };
  },
});

/**
 * The stored corpus from the team's last successful generation — the exact
 * evidence chat grounds in. Returns null when no ready brief exists.
 */
export const briefRowForChat = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const brief = await ctx.db
      .query("judgingBriefs")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .first();
    if (!brief || brief.status !== "ready" || !brief.corpus?.length) return null;
    return { corpus: brief.corpus };
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
    sources: v.array(
      v.object({
        sourceId: v.string(),
        source: v.string(),
        chars: v.number(),
        pages: v.optional(v.number()),
      }),
    ),
    corpusNotes: v.array(v.string()),
    corpus: v.array(
      v.object({
        sourceId: v.string(),
        source: v.string(),
        text: v.string(),
        pages: v.optional(
          v.array(v.object({ start: v.number(), end: v.number(), page: v.number() })),
        ),
      }),
    ),
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
      sources: args.sources,
      corpusNotes: args.corpusNotes,
      corpus: args.corpus,
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
      sources: [],
      corpusNotes: [],
      inputHash: "",
    });
  },
});
