/**
 * Server-side AI service layer.
 *
 * Everything that talks to an external AI vendor lives behind `AIProvider`.
 * The Convex action never imports a vendor SDK or hard-codes a URL: it asks
 * `getAIProvider()` for the active provider and calls `generateStructured`.
 * Swapping vendors later means adding one file and editing the factory —
 * no action, schema or UI changes.
 *
 * Where this file may run: server-side ONLY (Convex actions). It reads the
 * API key from the environment (the project's secure Keys mechanism), which
 * is never bundled into frontend code. No UI component imports this module,
 * and none should.
 */

/**
 * The one shape every provider must produce.
 *
 * `parsed` is whatever JSON the provider returned after being constrained by
 * the caller's response schema; verification of the *content* (grounding
 * quotes, criterion names) happens in the copilot module — the provider only
 * guarantees the transport and the JSON envelope.
 */
export type StructuredResult = {
  parsed: unknown;
  provider: string;
  model: string;
};

export interface AIProvider {
  /** Stable identifier persisted alongside generated analyses. */
  readonly name: string;
  /** Model identifier the provider will actually call. */
  readonly model: string;

  /**
   * Produce a structured JSON response.
   *
   * Implementations MUST constrain output to `schema` (structured output /
   * response schema), pass `system` as system instruction, and throw
   * `AIProviderError` with a judge-readable message on failure. Retryable
   * failures (rate limit, 5xx, network) are retried inside the provider;
   * non-retryable ones (invalid key, no usable output) are surfaced once.
   */
  generateStructured(input: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    schemaName: string;
    schemaDescription: string;
    /** Prior conversation turns for chat-style calls (oldest first). */
    history?: ChatTurn[];
    /** Inline binary attachments (e.g. PDF documents to transcribe). */
    attachments?: ProviderAttachment[];
  }): Promise<StructuredResult>;
}

/** One prior turn of a chat conversation. */
export type ChatTurn = { role: "user" | "model"; text: string };

/**
 * A binary attachment sent inline to the model (e.g. a PDF for transcription).
 * `data` is base64. Providers that cannot handle attachments reject them.
 */
export type ProviderAttachment = { mimeType: string; data: string };

/**
 * Errors that reach the judge as a "failed" brief row with a retry, rather
 * than an unhandled crash. `retryable` marks whether a later attempt could
 * plausibly succeed (network blip, provider outage, rate limit) versus a
 * configuration problem (missing/invalid key) that retrying will not fix.
 */
export class AIProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, opts?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "AIProviderError";
    this.retryable = opts?.retryable ?? false;
    this.status = opts?.status;
  }
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export const AI_ENV_VARS = {
  apiKey: "GEMINI_API_KEY",
  model: "GEMINI_MODEL",
} as const;

/** Current stable Gemini Flash model (Google AI for Developers model guide). */
export const DEFAULT_AI_MODEL = "gemini-3.8-flash";

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AIProviderError) return error.retryable;
  return true; // network TypeError etc.
}

// ---------------------------------------------------------------------------
// Gemini implementation
// ---------------------------------------------------------------------------

type GeminiPart = { text?: string };
type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
};

function extractHttpMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string };
    };
    if (parsed.error?.message) {
      return parsed.error.status
        ? `${parsed.error.status}: ${parsed.error.message}`
        : parsed.error.message;
    }
  } catch {
    // Non-JSON body; fall through to the raw text.
  }
  return raw.slice(0, 300);
}

function extractText(payload: GeminiResponse): string | null {
  const candidate = payload.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
  if (text && text.trim()) return text;
  if (payload.promptFeedback?.blockReason) {
    throw new AIProviderError(
      `The AI service declined this content (${payload.promptFeedback.blockReason}).`,
    );
  }
  return null;
}

/**
 * Google Gemini via the Generative Language REST API.
 *
 * - Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * - Auth: `x-goog-api-key` header — the key exists only in the server process.
 * - Structured output: generationConfig.responseMimeType = "application/json"
 *   plus a `responseSchema`, so the model is constrained to the caller's JSON
 *   shape by construction rather than asked politely.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model: string = DEFAULT_AI_MODEL,
    baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async generateStructured(input: {
    system: string;
    prompt: string;
    schema: Record<string, unknown>;
    schemaName: string;
    schemaDescription: string;
    history?: ChatTurn[];
    attachments?: ProviderAttachment[];
  }): Promise<StructuredResult> {
    // Gemini's responseSchema carries no schema name/description; the fields
    // exist on the interface so providers that need them (e.g. OpenAI-style
    // structured outputs) can use them without changing callers.
    void input.schemaName;
    void input.schemaDescription;

    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [
        ...(input.history ?? []).map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text }],
        })),
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...(input.attachments ?? []).map((a) => ({
              inlineData: { mimeType: a.mimeType, data: a.data },
            })),
          ],
        },
      ],
      // Temperature 1.0 is Google's explicit recommendation for Gemini 3
      // reasoning models; lower values can degrade or loop generation.
      generationConfig: {
        temperature: 1.0,
        maxOutputTokens: 16384,
        responseMimeType: "application/json",
        responseSchema: input.schema,
      },
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(
          `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify(body),
          },
        );

        if (!response.ok) {
          const raw = await response.text();
          const detail = extractHttpMessage(raw);
          const retryable = RETRYABLE_STATUS.has(response.status);
          if (response.status === 401 || response.status === 403) {
            throw new AIProviderError(
              "The configured AI key was rejected. Check GEMINI_API_KEY in the project's Keys settings.",
              { retryable: false, status: response.status },
            );
          }
          if (retryable && attempt < MAX_ATTEMPTS) {
            throw new AIProviderError(
              `The AI service returned ${response.status}.`,
              { retryable: true, status: response.status },
            );
          }
          throw new AIProviderError(
            `The AI service returned ${response.status}: ${detail}`,
            { retryable, status: response.status },
          );
        }

        const payload = (await response.json()) as GeminiResponse;
        const text = extractText(payload);
        if (!text) {
          throw new AIProviderError(
            "The AI service returned an empty response.",
            { retryable: attempt < MAX_ATTEMPTS },
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new AIProviderError(
            "The AI service returned malformed JSON.",
            { retryable: attempt < MAX_ATTEMPTS },
          );
        }

        return { parsed, provider: this.name, model: this.model };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === MAX_ATTEMPTS) break;
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    if (lastError instanceof AIProviderError) throw lastError;
    throw new AIProviderError(
      `Could not reach the AI service: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      { retryable: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let override: AIProvider | null = null;

/** Test hook: inject a fake provider; call with null to clear. */
export function setAIProviderOverride(provider: AIProvider | null): void {
  override = provider;
}

/**
 * Resolve the active provider. Today: Gemini. Adding a vendor means writing a
 * class that satisfies `AIProvider` and teaching this factory about it — the
 * actions, schema and UI are untouched.
 */
export function getAIProvider(): AIProvider {
  if (override) return override;

  const apiKey = process.env[AI_ENV_VARS.apiKey];
  if (!apiKey) {
    throw new AIProviderError(
      `No AI key is configured. Add ${AI_ENV_VARS.apiKey} in the project's Keys settings and try again.`,
    );
  }
  const model = process.env[AI_ENV_VARS.model]?.trim() || DEFAULT_AI_MODEL;
  return new GeminiProvider(apiKey, model);
}
