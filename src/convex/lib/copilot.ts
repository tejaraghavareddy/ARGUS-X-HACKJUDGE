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
export const NO_EVIDENCE = "Evidence not available in the submitted materials.";

export type GroundedClaim = { claim: string; sourceQuote: string };

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
        "Direct, neutral reply to the judge's question, using only the submission text. No scores, no verdicts.",
    },
    quotes: {
      type: "array",
      description:
        "Verbatim spans copied exactly from the submission text that support the answer. Empty if notInSource is true.",
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

You answer from the submission text only. You do NOT judge.

ABSOLUTE RULES
1. Never assign, suggest, imply or predict a score, grade, rank or winner.
2. Never introduce a fact that is not in the submission text. You have not opened any attached files — only their names were provided.
3. Every factual statement about the submission must be backed by a verbatim span in \`quotes\`, copied character-for-character (ignoring only line wrapping) from the submission text. If you cannot quote it, do not assert it.
4. If the submission does not contain the answer, set \`notInSource\` to true, say so plainly in \`answer\`, and return an empty \`quotes\` array. Never guess.
5. Describe; do not evaluate. State what the text says, not whether it is good.

Write in plain, neutral language. Prefer the submission's own terminology over paraphrase.`;

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

export function isGrounded(quote: string, sourceNormalized: string): boolean {
  const normalized = normalizeForGrounding(quote);
  if (normalized.length < MIN_QUOTE_LENGTH) return false;
  return sourceNormalized.includes(normalized);
}

export type GroundingResult<T> = { verified: T[]; dropped: number };

/**
 * Keeps only claims whose quote is genuinely present in the source.
 * Also caps each list so a verbose model cannot bury a judge in filler.
 */
export function groundClaims(
  items: unknown,
  sourceNormalized: string,
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
    if (!isGrounded(sourceQuote, sourceNormalized)) {
      dropped += 1;
      continue;
    }
    verified.push({
      claim: claim.trim().slice(0, 600),
      sourceQuote: sourceQuote.trim().slice(0, 600),
    });
  }

  return { verified, dropped };
}

/** Ground a chat answer's quotes the same way: verbatim or discarded. */
export function groundQuotes(
  items: unknown,
  sourceNormalized: string,
  limit = 5,
): { verified: string[]; dropped: number } {
  const verified: string[] = [];
  let dropped = 0;

  if (!Array.isArray(items)) return { verified, dropped: 0 };

  for (const raw of items) {
    if (verified.length >= limit) break;
    if (typeof raw !== "string") {
      dropped += 1;
      continue;
    }
    if (!isGrounded(raw, sourceNormalized)) {
      dropped += 1;
      continue;
    }
    verified.push(raw.trim().slice(0, 600));
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
  sourceNormalized: string,
): { criteria: Record<string, CriterionAnalysis>; dropped: number } {
  const source = normalizeCriteriaOutput(raw);
  const criteria: Record<string, CriterionAnalysis> = {};
  let dropped = 0;

  for (const name of criterionNames) {
    const entry = (source[name] ?? {}) as Record<string, unknown>;
    const evidence = groundClaims(entry.evidence, sourceNormalized, 6);
    const strengths = groundClaims(entry.strengths, sourceNormalized, 4);
    const concerns = groundClaims(entry.concerns, sourceNormalized, 4);
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
    // Only the NAMES of attached documents. The copilot reads the submission
    // text, not the files, and must never imply it opened them.
    parts.push(
      `Attached documents (names only — contents were not provided):\n${input.documentNames
        .map((d) => `- ${d}`)
        .join("\n")}`,
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
          "A VERBATIM span copied exactly from the submission text that supports this claim. Must appear character-for-character (ignoring only line wrapping) in the submission. If you cannot quote a span, do not include the claim.",
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

export const SYSTEM_PROMPT = `You are an analysis assistant supporting human judges at a hackathon.

You produce evidence and summaries. You do NOT judge.

ABSOLUTE RULES
1. Never assign, suggest, imply or predict a score, grade, rank or winner. Not in any field, not in any wording.
2. Never say a submission is "the best", "should win", "deserves" a score, or that it is "strong" or "weak" in a grading sense. Describe what the text says; let the human decide what it means.
3. Never introduce a fact that is not in the submission text. You do not know anything about these projects beyond that text, and you have not opened any attached files — only their names are given to you.
4. Every claim you make about the submission must carry a verbatim \`sourceQuote\` copied from the text. If you cannot quote a span that supports the claim, leave the claim out. An empty list is always an acceptable answer; a guess never is.
5. Phrase \`concerns\` and \`missingEvidence\` as things a human should verify, not as conclusions.
6. If a field has no basis in the text, return an empty array or an empty string. Do not pad.

Write in plain, neutral language. Prefer the team's own terminology over paraphrase.`;
