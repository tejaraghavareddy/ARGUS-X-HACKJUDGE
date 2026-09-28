/**
 * AI Judge Copilot — shared contract.
 *
 * No Convex and no vendor imports, so the same constants and types drive the
 * server action and the React panel without leaking server-only code (and
 * never the API key) into the client bundle.
 *
 * ---------------------------------------------------------------------------
 * The one idea this file exists to enforce
 * ---------------------------------------------------------------------------
 * "Do not invent facts that are not present in the submission" cannot be left
 * as a prompt instruction — models follow it well but not perfectly, and a
 * single confident invention in front of a judge is a serious product failure.
 *
 * So every claim the model makes ABOUT the submission must be accompanied by
 * `sourceQuote`: a verbatim span copied out of the text the model was given.
 * After generation, `groundClaims` re-reads each quote back against that same
 * text and DISCARDS any claim whose quote is not actually there. A model that
 * hallucinates produces a quote that does not exist, that quote fails the
 * substring check, and the claim is dropped before it is ever stored or shown.
 *
 * The drops are counted and surfaced to the judge, rather than hidden.
 */

// Shown wherever a model produced no verifiable evidence. Exact wording is
// specified by the product, so it lives in one place.
export const NO_EVIDENCE = "Evidence not available.";

/**
 * Where a piece of evidence came from. Every verified claim carries one so a
 * judge can always answer "says who?" — the submission text, the GitHub
 * README, the repo analyzer, or an uploaded document (with a page number
 * when the document has pages).
 */
export type SourceAttribution = {
  /** Stable document id from the evidence corpus ("form", "github-readme", …). */
  sourceId: string;
  /** Human label shown in the UI, e.g. "Project documentation" or "README (GitHub)". */
  source: string;
  /** Page number for paginated sources (PDFs); 1-based. Absent for others. */
  page?: number;
};

export type GroundedClaim = {
  claim: string;
  sourceQuote: string;
  /** Where the quote was verified — filled by the server, never the model. */
  source?: SourceAttribution;
};

/** A document in the evidence corpus the model may quote from. */
export type SourceDocument = {
  sourceId: string;
  source: string;
  /** Verbatim text; every quote is checked against this. */
  text: string;
  /** For paginated documents: the page each character range belongs to. */
  pages?: { start: number; end: number; page: number }[];
};

export type CriterionAnalysis = {
  evidence: GroundedClaim[];
  strengths: GroundedClaim[];
  concerns: GroundedClaim[];
  missingEvidence: string[];
  questions: string[];
};

export type ProjectBrief = {
  executiveSummary: string;
  problemSummary: string;
  solution: string;
  targetUsers: string;
  keyFeatures: string[];
  techStack: string[];
  architectureSummary: string;
  innovationIndicators: GroundedClaim[];
  impactIndicators: GroundedClaim[];
  implementationIndicators: GroundedClaim[];
  missingInformation: string[];
};

export type CopilotOutput = {
  brief: ProjectBrief;
  criteria: Record<string, CriterionAnalysis>;
};

/** Provenance of a generated analysis, shown to the judge. */
export type SourcesUsed = {
  sourceId: string;
  source: string;
  chars: number;
  pages?: number;
};

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Stable name persisted with every generated analysis. */
export const PROVIDER_NAME = "gemini";

/** Current stable Gemini Flash model (Google AI for Developers model guide). */
export const DEFAULT_MODEL = "gemini-3.8-flash";

/** Overridable so the deployment is not pinned to a model that may be retired. */
export const MODEL_ENV_VAR = "GEMINI_MODEL";
export const API_KEY_ENV_VAR = "GEMINI_API_KEY";

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** A prior turn of the judge's copilot chat, as the client sends it. */
export type ChatMessage = { role: "user" | "model"; text: string };

/** Structured chat answer. */
export type ChatAnswer = {
  answer: string;
  /** Verbatim spans from the source text backing the answer. */
  quotes: string[];
  /** True when the source text simply does not contain the answer. */
  notInSource: boolean;
};

export const CHAT_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "Direct, neutral reply to the judge's question, using only the evidence corpus. No scores, no verdicts.",
    },
    quotes: {
      type: "array",
      description:
        "Verbatim spans copied exactly from a document of the evidence corpus that support the answer. Empty if notInSource is true.",
      items: { type: "string" },
      maxItems: 5,
    },
    notInSource: {
      type: "boolean",
      description:
        "True when the submission text does not contain the information needed to answer.",
    },
  },
  required: ["answer", "quotes", "notInSource"],
} as const;

export const CHAT_SYSTEM_PROMPT = `You are an analysis assistant supporting a human judge at a hackathon, answering questions about ONE submission.

You answer from the provided evidence corpus only. You do NOT judge. The corpus is a set of labelled documents wrapped in <document source="..."> tags: the submission form, the GitHub README, the repository analysis, and any uploaded documents. Nothing beyond those documents is available to you.

ABSOLUTE RULES
1. Never assign, suggest, imply or predict a score, grade, rank or winner.
2. Never introduce a fact that is not in the evidence corpus. You have not opened anything beyond the documents provided.
3. Every factual statement about the submission must be backed by a verbatim span in \`quotes\`, copied character-for-character (ignoring only line wrapping) from the corpus. If you cannot quote it, do not assert it.
4. If the corpus does not contain the answer, set \`notInSource\` to true, say exactly \`${NO_EVIDENCE}\` in \`answer\` (and say plainly which part is missing), and return an empty \`quotes\` array. Never guess, and never answer from general knowledge of the technologies involved.
5. Describe; do not evaluate. State what the evidence says, not whether it is good.
6. Distinguish what the materials state from your own reading of them. When you interpret ("this implies…", "this suggests…"), say so explicitly as interpretation and do not attach a quote to the interpretation itself. The source document and page for each quote are resolved automatically from the quote text.

Write in plain, neutral language. Prefer the materials' own terminology over paraphrase.`;;

// ---------------------------------------------------------------------------
// Grounding
// ---------------------------------------------------------------------------

/**
 * Aggressively normalized for comparison: case, punctuation and all whitespace
 * differences are removed, so a model that re-wrapped a paragraph or dropped a
 * comma still produces a match. Anything that changes actual words still fails.
 */
export function normalizeForGrounding(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimum normalized length for a quote to count as evidence at all. */
const MIN_QUOTE_LENGTH = 20;

/**
 * The evidence corpus: every document the model was shown, each with its own
 * normalized text. Verification is corpus-wide — a quote may come from the
 * submission form, the GitHub README, the repo analyzer, or an uploaded file —
 * and the document whose text contains the quote determines the claim's
 * source attribution.
 */
export type EvidenceCorpus = {
  documents: SourceDocument[];
  /** Normalized text per document, aligned with `documents`. */
  normalized: string[];
  /** Flattened normalized text across all documents (fast first-pass check). */
  combined: string;
};

/** Build the corpus once per generation; verified against for every claim. */
export function buildCorpus(documents: SourceDocument[]): EvidenceCorpus {
  return {
    documents,
    normalized: documents.map((d) => normalizeForGrounding(d.text)),
    combined: documents.map((d) => normalizeForGrounding(d.text)).join(" "),
  };
}

/**
 * Resolve the source of a verified quote: which document contained it, and
 * (for paginated documents) which page. The FIRST document containing the
 * normalized quote wins; documents are ordered form-first so the submission
 * text is preferred as the canonical source.
 */
export function resolveSource(
  quote: string,
  corpus: EvidenceCorpus,
): SourceAttribution | undefined {
  const normalized = normalizeForGrounding(quote);
  for (let i = 0; i < corpus.documents.length; i += 1) {
    if (!corpus.normalized[i].includes(normalized)) continue;
    const doc = corpus.documents[i];
    let page: number | undefined;
    if (doc.pages && doc.pages.length > 0) {
      // Page attribution is done by normalizing each page range on its own
      // and testing containment, rather than by mapping a character index
      // across the whole document: normalization changes string length, so a
      // flattened index would drift and misattribute the page.
      for (const range of doc.pages) {
        const slice = doc.text.slice(range.start, range.end + 1);
        if (slice && normalizeForGrounding(slice).includes(normalized)) {
          page = range.page;
          break;
        }
      }
    }
    return {
      sourceId: doc.sourceId,
      source: doc.source,
      ...(page !== undefined ? { page } : {}),
    };
  }
  return undefined;
}

export function isGroundedInCorpus(quote: string, corpus: EvidenceCorpus): boolean {
  const normalized = normalizeForGrounding(quote);
  if (normalized.length < MIN_QUOTE_LENGTH) return false;
  return corpus.combined.includes(normalized);
}

export type GroundingResult<T> = { verified: T[]; dropped: number };

/**
 * Keeps only claims whose quote is genuinely present in SOME document of the
 * corpus, and attaches the source (and page, when available) the quote was
 * verified against. Also caps each list so a verbose model cannot bury a
 * judge in filler.
 */
export function groundClaims(
  items: unknown,
  corpus: EvidenceCorpus,
  limit = 6,
): GroundingResult<GroundedClaim> {
  const verified: GroundedClaim[] = [];
  let dropped = 0;

  if (!Array.isArray(items)) return { verified, dropped: 0 };

  for (const raw of items) {
    if (verified.length >= limit) break;
    if (!raw || typeof raw !== "object") {
      dropped += 1;
      continue;
    }
    const { claim, sourceQuote } = raw as Record<string, unknown>;
    if (typeof claim !== "string" || typeof sourceQuote !== "string") {
      dropped += 1;
      continue;
    }
    if (!isGroundedInCorpus(sourceQuote, corpus)) {
      dropped += 1;
      continue;
    }
    const trimmedQuote = sourceQuote.trim().slice(0, 600);
    const source = resolveSource(trimmedQuote, corpus);
    verified.push({
      claim: claim.trim().slice(0, 600),
      sourceQuote: trimmedQuote,
      ...(source ? { source } : {}),
    });
  }

  return { verified, dropped };
}

/**
 * Ground a chat answer's quotes the same way: verbatim in SOME corpus
 * document or discarded, with source attribution (and page when available).
 */
export function groundQuotes(
  items: unknown,
  corpus: EvidenceCorpus,
  limit = 5,
): { verified: { quote: string; source: SourceAttribution }[]; dropped: number } {
  const verified: { quote: string; source: SourceAttribution }[] = [];
  let dropped = 0;

  if (!Array.isArray(items)) return { verified, dropped: 0 };

  for (const raw of items) {
    if (verified.length >= limit) break;
    if (typeof raw !== "string") {
      dropped += 1;
      continue;
    }
    if (!isGroundedInCorpus(raw, corpus)) {
      dropped += 1;
      continue;
    }
    const trimmed = raw.trim().slice(0, 600);
    const source = resolveSource(trimmed, corpus);
    if (!source) {
      dropped += 1;
      continue;
    }
    verified.push({ quote: trimmed, source });
  }

  return { verified, dropped };
}

/** Plain strings need no grounding, but do need bounding and cleaning. */
export function cleanStrings(
  value: unknown,
  limit = 8,
  maxLength = 600,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * The model may return `criteria` either as the requested array of entries or,
 * disobeying slightly, as an object keyed by criterion name. Both are accepted
 * here so one loose response shape cannot turn into a runtime failure —
 * verification still applies to whichever shape arrived.
 */
export function normalizeCriteriaOutput(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const name =
        typeof entry.criterion === "string" ? entry.criterion.trim() : "";
      if (name) out[name] = entry;
    }
    return out;
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/**
 * Drop any criterion the model did not return, and any criterion the caller did
 * not ask about. The rubric is the source of truth for which criteria exist —
 * the model can populate them but never invent them.
 */
export function sanitizeCriteria(
  raw: unknown,
  criterionNames: string[],
  corpus: EvidenceCorpus,
): { criteria: Record<string, CriterionAnalysis>; dropped: number } {
  const source = normalizeCriteriaOutput(raw);
  const criteria: Record<string, CriterionAnalysis> = {};
  let dropped = 0;

  for (const name of criterionNames) {
    const entry = (source[name] ?? {}) as Record<string, unknown>;
    const evidence = groundClaims(entry.evidence, corpus, 6);
    const strengths = groundClaims(entry.strengths, corpus, 4);
    const concerns = groundClaims(entry.concerns, corpus, 4);
    dropped += evidence.dropped + strengths.dropped + concerns.dropped;

    criteria[name] = {
      evidence: evidence.verified,
      strengths: strengths.verified,
      concerns: concerns.verified,
      missingEvidence: cleanStrings(entry.missingEvidence, 6, 400),
      questions: cleanStrings(entry.questions, 6, 400),
    };
  }

  return { criteria, dropped };
}

// ---------------------------------------------------------------------------
// Source text
// ---------------------------------------------------------------------------

export type SourceInput = {
  projectName: string;
  techStack: string[];
  problemStatement?: string | null;
  solutionDescription?: string | null;
  targetUsers?: string | null;
  keyFeatures: string[];
  innovation?: string | null;
  expectedImpact?: string | null;
  implementationDetails?: string | null;
  futureScope?: string | null;
  abstract?: string | null;
  documentNames: string[];
};

/**
 * The exact text the model is shown and the exact text every quote is verified
 * against. Built once and used for both, so there is no possibility of the two
 * drifting apart — which would make verification meaningless.
 *
 * `blind` drops the team's identity entirely, so under blind judging the model
 * is structurally unable to leak a name into its analysis.
 */
export function buildSourceText(input: SourceInput, blind: boolean): string {
  const parts: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const text = (value ?? "").trim();
    if (text) parts.push(`${label}:\n${text}`);
  };

  push("Project name", input.projectName);
  push("Problem statement", input.problemStatement);
  push("Solution description", input.solutionDescription);
  push("Target users", input.targetUsers);
  if (input.keyFeatures.length > 0) {
    parts.push(`Key features:\n${input.keyFeatures.map((f) => `- ${f}`).join("\n")}`);
  }
  push("Innovation", input.innovation);
  push("Expected impact", input.expectedImpact);
  push("Implementation details", input.implementationDetails);
  push("Future scope", input.futureScope);
  push("Summary", input.abstract);
  if (input.techStack.length > 0) {
    parts.push(`Technology stack:\n${input.techStack.join(", ")}`);
  }
  if (input.documentNames.length > 0) {
    // The NAMES of attached documents. Readable files are added to the corpus
    // as their own labelled documents, so this list must never imply that a
    // document was read when no block for it exists.
    parts.push(
      `Attached documents:\n${input.documentNames.map((d) => `- ${d}`).join("\n")}`,
    );
  }
  if (blind) {
    parts.push(
      "Note: team identity was withheld from this analysis because blind judging is enabled.",
    );
  }
  return parts.join("\n\n");
}

/** Stable hash of the source text, used to detect a stale brief. */
export function hashSource(text: string): string {
  // FNV-1a. Not cryptographic — this only needs to change when the text does.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Corpus assembly
// ---------------------------------------------------------------------------

/** A file a team attached, as the database knows it (no contents). */
export type UploadedFileRef = {
  fileName: string;
  contentType: string;
  storageId: string;
};

/** Ceiling on an uploaded text file the copilot will read inline (2 MB). */
const MAX_UPLOADED_TEXT_BYTES = 2_000_000;

/**
 * Read the uploaded materials the copilot can use: text files inline, PDFs
 * left for the provider's page-aware transcription path.
 *
 * This runs in an ACTION, not a query, because Convex queries may not perform
 * network I/O — a file's text simply cannot be fetched from a query. The
 * caller supplies the storage reader (`ctx.storage.get`), so the same function
 * serves the generation action and the evidence preview.
 */
export async function collectUploadedMaterials(
  files: UploadedFileRef[],
  readBlob: (storageId: string) => Promise<Blob | null>,
): Promise<{
  texts: { fileName: string; text: string | null }[];
  pdfs: { fileName: string; storageId: string }[];
}> {
  const texts: { fileName: string; text: string | null }[] = [];
  const pdfs: { fileName: string; storageId: string }[] = [];

  for (const file of files) {
    if (file.contentType === "application/pdf") {
      pdfs.push({ fileName: file.fileName, storageId: file.storageId });
      continue;
    }
    if (
      !/^text\//.test(file.contentType) &&
      !/json|markdown|csv|xml|yaml/i.test(file.contentType)
    ) {
      // Binary formats the copilot has no way to read are not corpus: saying
      // so is better than silently pretending they were read.
      texts.push({ fileName: file.fileName, text: null });
      continue;
    }

    let text: string | null = null;
    try {
      const blob = await readBlob(file.storageId);
      if (blob && blob.size <= MAX_UPLOADED_TEXT_BYTES) {
        text = await blob.text();
      }
    } catch {
      text = null;
    }
    texts.push({ fileName: file.fileName, text });
  }

  return { texts, pdfs };
}

/** Everything the corpus is built from, before any PDF transcription. */
export type CorpusMaterials = {
  /** The structured submission form, already rendered to text. */
  formText: string;
  /** README text captured by the GitHub analyzer, when one has been run. */
  githubReadme?: { text: string } | null;
  /** Deterministic report from the GitHub analyzer, when one exists. */
  githubSummary?: string | null;
  /** Text of each readable uploaded file (null when it could not be read). */
  uploadedTexts?: { fileName: string; text: string | null }[];
  /** Per-document character ceiling. */
  maxDocChars: number;
};

/**
 * Build the non-PDF part of the evidence corpus. Order is fixed and
 * meaningful: the submission form comes first, so when a phrase appears in
 * more than one document the submission itself is named as the source.
 *
 * Shared by generation and by the pre-generation preview, so what a judge is
 * shown is exactly what the model will be given.
 */
export function buildCorpusDocuments(materials: CorpusMaterials): {
  documents: SourceDocument[];
  notes: string[];
} {
  const { maxDocChars } = materials;
  const documents: SourceDocument[] = [];
  const notes: string[] = [];

  if (materials.formText.trim()) {
    documents.push({
      sourceId: "form",
      source: "Project documentation",
      text: materials.formText,
    });
  }
  if (materials.githubReadme?.text) {
    documents.push({
      sourceId: "github-readme",
      source: "README (GitHub)",
      text: materials.githubReadme.text.slice(0, maxDocChars),
    });
  }
  if (materials.githubSummary) {
    documents.push({
      sourceId: "github-analysis",
      source: "GitHub repository analysis",
      text: materials.githubSummary.slice(0, maxDocChars),
    });
  }
  for (const file of materials.uploadedTexts ?? []) {
    if (!file.text?.trim()) {
      notes.push(
        `${file.fileName} is attached but its text could not be read, so it is not part of the evidence`,
      );
      continue;
    }
    documents.push({
      sourceId: `file:${file.fileName}`,
      source: `Uploaded document — ${file.fileName}`,
      text: file.text.slice(0, maxDocChars),
    });
  }

  return { documents, notes };
}

/** Render corpus documents as labelled blocks for the model's user turn. */
export function renderCorpusBlocks(documents: SourceDocument[]): string {
  return documents
    .map((d) => `<document source="${d.source}">\n${d.text}\n</document>`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Model contract (Gemini responseSchema)
// ---------------------------------------------------------------------------

const claimList = (description: string) => ({
  type: "array",
  description,
  items: {
    type: "object",
    properties: {
      claim: {
        type: "string",
        description:
          "A short, factual observation stated in neutral language. Never a verdict, never a grade, never a ranking.",
      },
      sourceQuote: {
        type: "string",
        description:
          "A VERBATIM span copied exactly from one document of the evidence corpus that supports this claim. Must appear character-for-character (ignoring only line wrapping) in that document. If you cannot quote a span, do not include the claim.",
      },
    },
    required: ["claim", "sourceQuote"],
  },
});

const stringList = (description: string, maxItems: number) => ({
  type: "array",
  description,
  items: { type: "string" },
  maxItems,
});

/**
 * The JSON schema handed to Gemini as `responseSchema`, so the response is
 * constrained to this shape by construction — there is no prose path.
 *
 * Note on shape: Gemini's responseSchema does not support map-style
 * `additionalProperties`, so `criteria` is requested as an ARRAY with a strict
 * `enum` on the criterion name. `normalizeCriteriaOutput` accepts either the
 * requested array or a key-object if the model drifts.
 */
export function buildBriefSchema(
  criterionNames: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      brief: {
        type: "object",
        properties: {
          executiveSummary: {
            type: "string",
            description:
              "Two or three sentences describing what this project is. Description only — no evaluation.",
          },
          problemSummary: {
            type: "string",
            description: "Restates the problem in your own words, neutrally.",
          },
          solution: {
            type: "string",
            description: "Describes the proposed solution factually.",
          },
          targetUsers: {
            type: "string",
            description: "Who the team says this is for.",
          },
          keyFeatures: stringList(
            "The features the team listed, restated concisely.",
            10,
          ),
          techStack: stringList(
            "Technologies named in the submission. Only ones actually present in the text.",
            15,
          ),
          architectureSummary: {
            type: "string",
            description:
              "How the system appears to be put together, based only on the text. If the submission does not describe the architecture, return an empty string.",
          },
          innovationIndicators: claimList(
            "Observations bearing on novelty, each with a verbatim quote.",
          ),
          impactIndicators: claimList(
            "Observations bearing on expected impact, each with a verbatim quote.",
          ),
          implementationIndicators: claimList(
            "Observations bearing on how well it is built, each with a verbatim quote.",
          ),
          missingInformation: stringList(
            "Things a judge would need that the submission does not provide. Phrase as absences, e.g. 'No test results are reported.'",
            8,
          ),
        },
        required: [
          "executiveSummary",
          "problemSummary",
          "solution",
          "targetUsers",
          "keyFeatures",
          "techStack",
          "architectureSummary",
          "innovationIndicators",
          "impactIndicators",
          "implementationIndicators",
          "missingInformation",
        ],
      },
      criteria: {
        type: "array",
        description:
          "One entry per judging criterion. `criterion` must be EXACTLY one of the criterion names supplied in the user message. Do not add, rename or omit criteria.",
        items: {
          type: "object",
          properties: {
            criterion: {
              type: "string",
              description: "The criterion name, copied exactly as supplied.",
              enum: criterionNames,
            },
            evidence: claimList(
              "Verbatim-backed evidence in the submission relevant to this criterion.",
            ),
            strengths: claimList(
              "Potential strengths, each backed by a verbatim quote.",
            ),
            concerns: claimList(
              "Points a human judge may want to probe. State them as observations about the text, never as conclusions or grades.",
            ),
            missingEvidence: stringList(
              "Evidence this criterion would need that the submission does not contain.",
              6,
            ),
            questions: stringList(
              "Questions the judge may want to ask the team about this criterion.",
              6,
            ),
          },
          required: [
            "criterion",
            "evidence",
            "strengths",
            "concerns",
            "missingEvidence",
            "questions",
          ],
        },
      },
    },
    required: ["brief", "criteria"],
  };
}

// ---------------------------------------------------------------------------
// GitHub repository analysis — optional LLM narrative layer
// ---------------------------------------------------------------------------

/** The JSON shape the repo-analysis narrative is constrained to. */
export const REPO_NARRATIVE_SCHEMA = {
  type: "object",
  properties: {
    narrative: {
      type: "string",
      description:
        "Concise neutral technical reading of the detected evidence (2-4 sentences). Describe only what the evidence shows. Never evaluate quality or compare to other projects.",
    },
  },
  required: ["narrative"],
} as const;

export const REPO_NARRATIVE_PROMPT = `You support hackathon judges by reading a deterministic repository scan.

You are given detected evidence items, each with the file it came from. Write a SHORT neutral technical reading of what the repository contains.

ABSOLUTE RULES
1. Use ONLY the evidence provided. Do not add capabilities, tools, or practices that are not in the evidence.
2. Never evaluate quality, never rank, never score, never compare against other projects or "typical" repos.
3. NEVER claim a feature does not exist. Where evidence is thin, describe what WAS found, and leave absence unstated — the report handles absence with fixed wording.
4. Attribute to files where natural ("the package manifest declares…", "the workflows directory contains…").
5. Two to four sentences. Plain language. No bullet lists in the narrative.

Write in plain, neutral language.`;

// ---------------------------------------------------------------------------
// PDF transcription (multimodal) — page-aware corpus input
// ---------------------------------------------------------------------------

/** A page-aware transcription of one uploaded PDF. */
export type PdfTranscription = {
  text: string;
  /** Character ranges in `text` and the 1-based PDF page each covers. */
  pages: { start: number; end: number; page: number }[];
};

export const PDF_TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      description: "One entry per page of the document, in order.",
      items: {
        type: "object",
        properties: {
          page: { type: "integer", description: "1-based page number." },
          text: {
            type: "string",
            description:
              "Verbatim transcription of that page. If the page is blank or unreadable, return an empty string.",
          },
        },
        required: ["page", "text"],
      },
    },
  },
  required: ["pages"],
} as const;

export const PDF_TRANSCRIBE_PROMPT = `Transcribe the attached document for an analysis record.

Return one entry per page with its 1-based page number and the VERBATIM text of that page.

RULES
- Transcribe only what is written. Do not summarize, correct, translate, or complete anything.
- Preserve the original wording exactly; minor line-wrap changes are acceptable.
- If a page is blank, an image with no readable text, or unreadable, return an empty string for that page.
- Do not invent page numbers: one entry per actual page, in document order.`;

/**
 * A transcription response after server-side verification: each page's text
 * is stored with the exact character range it occupies in the joined text.
 */
export function assembleTranscription(
  raw: unknown,
): PdfTranscription {
  const pagesIn = (raw as { pages?: unknown })?.pages;
  let text = "";
  const pages: { start: number; end: number; page: number }[] = [];
  if (Array.isArray(pagesIn)) {
    for (const rawPage of pagesIn) {
      const page = (rawPage ?? {}) as Record<string, unknown>;
      const pageNo = typeof page.page === "number" ? Math.floor(page.page) : 0;
      const content = typeof page.text === "string" ? page.text.trim() : "";
      if (pageNo < 1 || !content) continue;
      const start = text.length;
      text += (text ? "\n\n" : "") + content;
      pages.push({ start, end: text.length, page: pageNo });
    }
  }
  return { text, pages };
}

export const SYSTEM_PROMPT = `You are an analysis assistant supporting human judges at a hackathon.

You produce evidence and summaries. You do NOT judge.

You work ONLY from the EVIDENCE CORPUS supplied in the user message: a set of labelled documents (the submission form, the GitHub README, the repository analysis, and any uploaded documents the team provided). Each document is wrapped in <document source="..."> tags; the source label is the document's origin. Nothing outside those documents is available to you, and a document that has no block was not readable.

ABSOLUTE RULES
1. Never assign, suggest, imply or predict a score, grade, rank or winner. Not in any field, not in any wording.
2. Never say a submission is "the best", "should win", "deserves" a score, or that it is "strong" or "weak" in a grading sense. Describe what the evidence says; let the human decide what it means.
3. Never introduce a fact that is not in the evidence corpus.
4. Every claim you make about the submission must carry a verbatim \`sourceQuote\` copied from whichever corpus document supports it. If you cannot quote a span that supports the claim, leave the claim out. An empty list is always an acceptable answer; a guess never is. (The source document and page are resolved from your quote automatically — you do not need to state them, but never quote a document you were not shown.)
5. Phrase \`concerns\` and \`missingEvidence\` as things a human should verify, not as conclusions.
6. If a field has no basis in the corpus, return the exact string \`${NO_EVIDENCE}\` for text fields, or an empty array for list fields. Do not pad, and do not substitute general knowledge about the technology involved.
7. Keep three things separate in your wording: what the submission EVIDENCE states, what you are INTERPRETING from it, and what a human judge might still need to check. Never present an interpretation as a quoted fact.

Write in plain, neutral language. Prefer the team's own terminology over paraphrase.`;
