/**
 * Shared submission rules.
 *
 * This module intentionally imports nothing — not even Convex — so that the
 * exact same constants drive the React form and the authoritative server-side
 * validation. The server is always the source of truth (it re-validates on
 * save and again on final submit), but the client uses these to give instant,
 * accurate inline feedback.
 */

export type SubmissionFieldKey =
  | "projectName"
  | "problemStatement"
  | "solutionDescription"
  | "targetUsers"
  | "keyFeatures"
  | "innovation"
  | "expectedImpact"
  | "techStack"
  | "implementationDetails"
  | "futureScope";

export type UrlFieldKey = "repoUrl" | "demoUrl" | "videoUrl";

export type FileKind = "presentation" | "documentation" | "architecture" | "supporting";

export interface FieldSpec {
  key: SubmissionFieldKey;
  label: string;
  placeholder: string;
  hint: string;
  /** Longer answers get a textarea. */
  long: boolean;
  required: boolean;
  minLength: number;
  maxLength: number;
}

export const SUBMISSION_FIELDS: FieldSpec[] = [
  {
    key: "projectName",
    label: "Project name",
    placeholder: "e.g. Medisense",
    hint: "The name your team will be judged on. Keep it short and memorable.",
    long: false,
    required: true,
    minLength: 2,
    maxLength: 80,
  },
  {
    key: "problemStatement",
    label: "Problem statement",
    placeholder: "What is broken today, and for whom?",
    hint: "Describe the problem with evidence. Who experiences it, how often, and what does it cost them?",
    long: true,
    required: true,
    minLength: 40,
    maxLength: 2000,
  },
  {
    key: "solutionDescription",
    label: "Solution description",
    placeholder: "What did you build, and how does it work?",
    hint: "Explain your approach end to end. Judges should be able to follow it without asking you anything.",
    long: true,
    required: true,
    minLength: 40,
    maxLength: 3000,
  },
  {
    key: "targetUsers",
    label: "Target users",
    placeholder: "Who specifically uses this?",
    hint: "Be concrete. Name the roles, not just “everyone”. If you validated with real users, say so.",
    long: true,
    required: true,
    minLength: 20,
    maxLength: 1000,
  },
  {
    key: "keyFeatures",
    label: "Key features",
    placeholder: "List the three to five things that matter most.",
    hint: "One per line. Lead with the feature you would demo first.",
    long: true,
    required: true,
    minLength: 15,
    maxLength: 1200,
  },
  {
    key: "innovation",
    label: "Innovation",
    placeholder: "What is genuinely new here?",
    hint: "Differentiate from existing tools. “We used an LLM” is not innovation; what it let you do that was not possible before is.",
    long: true,
    required: true,
    minLength: 30,
    maxLength: 1500,
  },
  {
    key: "expectedImpact",
    label: "Expected impact",
    placeholder: "What changes if this works?",
    hint: "Include scale and a realistic timeline. State honestly what you could not yet measure.",
    long: true,
    required: true,
    minLength: 30,
    maxLength: 1500,
  },
  {
    key: "techStack",
    label: "Technology stack",
    placeholder: "React, Convex, Postgres, Whisper…",
    hint: "Comma or newline separated. Include the significant choices, not every dependency.",
    long: false,
    required: true,
    minLength: 3,
    maxLength: 400,
  },
  {
    key: "implementationDetails",
    label: "Implementation details",
    placeholder: "How is it built and hosted?",
    hint: "Architecture, data flow, and anything a technical judge would want to interrogate.",
    long: true,
    required: true,
    minLength: 30,
    maxLength: 2500,
  },
  {
    key: "futureScope",
    label: "Future scope",
    placeholder: "What would you build next?",
    hint: "Show you know the limits of the current build. A credible next step beats an ambitious list.",
    long: true,
    required: true,
    minLength: 20,
    maxLength: 1500,
  },
];

export const URL_FIELDS: {
  key: UrlFieldKey;
  label: string;
  placeholder: string;
  required: boolean;
  /** Extra host allowlist, e.g. GitHub only. Empty means any http(s) host. */
  hosts: string[];
}[] = [
  {
    key: "repoUrl",
    label: "GitHub URL",
    placeholder: "https://github.com/your-team/your-project",
    required: true,
    hosts: ["github.com", "www.github.com", "gitlab.com", "bitbucket.org"],
  },
  {
    key: "demoUrl",
    label: "Live demo URL",
    placeholder: "https://your-app.example.com",
    required: false,
    hosts: [],
  },
  {
    key: "videoUrl",
    label: "Demo video URL",
    placeholder: "https://www.youtube.com/watch?v=…",
    required: false,
    hosts: ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com", "www.vimeo.com", "loom.com", "www.loom.com"],
  },
];

export const FILE_KINDS: {
  key: FileKind;
  label: string;
  description: string;
  accept: string;
  extensions: string[];
  maxBytes: number;
  required: boolean;
  multiple: boolean;
}[] = [
  {
    key: "presentation",
    label: "Presentation",
    description: "Your pitch deck, PDF or PowerPoint.",
    accept: ".pdf,.ppt,.pptx",
    extensions: ["pdf", "ppt", "pptx"],
    maxBytes: 25 * 1024 * 1024,
    required: true,
    multiple: false,
  },
  {
    key: "documentation",
    label: "Documentation",
    description: "README, spec, or user guide.",
    accept: ".pdf,.md,.txt,.doc,.docx",
    extensions: ["pdf", "md", "txt", "doc", "docx"],
    maxBytes: 15 * 1024 * 1024,
    required: true,
    multiple: false,
  },
  {
    key: "architecture",
    label: "Architecture diagram",
    description: "A diagram of how the system fits together.",
    accept: ".png,.jpg,.jpeg,.svg,.pdf",
    extensions: ["png", "jpg", "jpeg", "svg", "pdf"],
    maxBytes: 10 * 1024 * 1024,
    required: false,
    multiple: false,
  },
  {
    key: "supporting",
    label: "Additional supporting files",
    description: "Anything else that supports your submission.",
    accept: ".pdf,.zip,.csv,.json,.md,.txt,.png,.jpg",
    extensions: ["pdf", "zip", "csv", "json", "md", "txt", "png", "jpg"],
    maxBytes: 20 * 1024 * 1024,
    required: false,
    multiple: true,
  },
];

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Shared URL rule. Optional fields are only rejected when they contain something. */
export function checkUrl(
  raw: string,
  hosts: string[] = [],
): { ok: true } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "This link is required." };
  if (value.length > 500) return { ok: false, error: "Link is too long." };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full URL including https://" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Link must start with http:// or https://" };
  }
  if (hosts.length > 0 && !hosts.includes(parsed.hostname.toLowerCase())) {
    return { ok: false, error: `Must be hosted on ${hosts[0]}` };
  }
  return { ok: true };
}

export function checkFile(
  kind: FileKind,
  name: string,
  size: number,
): { ok: true } | { ok: false; error: string } {
  const spec = FILE_KINDS.find((f) => f.key === kind);
  if (!spec) return { ok: false, error: "Unknown file type." };
  if (name.length > 120) return { ok: false, error: "File name is too long." };
  if (!spec.extensions.includes(fileExtension(name))) {
    return { ok: false, error: `${spec.label} must be one of: ${spec.extensions.join(", ")}` };
  }
  if (size <= 0) return { ok: false, error: "File appears to be empty." };
  if (size > spec.maxBytes) {
    return { ok: false, error: `${spec.label} must be under ${formatBytes(spec.maxBytes)}` };
  }
  return { ok: true };
}

/**
 * The form's value model. Every key is optional because this is what a blank
 * form looks like — the validators decide what is actually required.
 */
export type SubmissionValues = {
  [K in SubmissionFieldKey | UrlFieldKey]?: string;
};

/**
 * A text field only counts as complete when it clears its own minimum — not
 * merely when it is non-empty. That keeps the completion percentage honest.
 */
export function fieldError(spec: FieldSpec, raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return spec.required ? `${spec.label} is required.` : null;
  if (value.length < spec.minLength) {
    return `${spec.label} needs at least ${spec.minLength} characters (${value.length} so far).`;
  }
  if (value.length > spec.maxLength) {
    return `${spec.label} must be under ${spec.maxLength} characters.`;
  }
  return null;
}

export interface CompletionInput {
  values: SubmissionValues;
  /** Which file kinds currently have at least one uploaded file. */
  uploadedKinds: FileKind[];
}

/**
 * Completion is computed over the items a final submission actually needs:
 * every required text field, every required URL, and every required file.
 * Optional items are excluded so the number always reflects a submittable
 * state rather than 100% being unachievable.
 */
export function completionPercent(input: CompletionInput): number {
  const requiredFields = SUBMISSION_FIELDS.filter((f) => f.required);
  const requiredUrls = URL_FIELDS.filter((u) => u.required);
  const requiredFiles = FILE_KINDS.filter((f) => f.required);

  let done = 0;
  const total = requiredFields.length + requiredUrls.length + requiredFiles.length;

  for (const spec of requiredFields) {
    if (!fieldError(spec, input.values[spec.key])) done += 1;
  }
  for (const url of requiredUrls) {
    if (checkUrl(input.values[url.key] ?? "", url.hosts).ok) done += 1;
  }
  for (const file of requiredFiles) {
    if (input.uploadedKinds.includes(file.key)) done += 1;
  }

  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Everything blocking a final submit, keyed by field. Empty object means ready. */
export function validateForSubmit(
  values: SubmissionValues,
  uploadedKinds: FileKind[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const spec of SUBMISSION_FIELDS) {
    const error = fieldError(spec, values[spec.key]);
    if (error) errors[spec.key] = error;
  }
  for (const url of URL_FIELDS) {
    const raw = (values[url.key] ?? "").trim();
    if (!raw) {
      if (url.required) errors[url.key] = `${url.label} is required.`;
      continue;
    }
    const result = checkUrl(raw, url.hosts);
    if (!result.ok) errors[url.key] = result.error;
  }
  for (const file of FILE_KINDS) {
    if (file.required && !uploadedKinds.includes(file.key)) {
      errors[`file:${file.key}`] = `${file.label} is required before you can submit.`;
    }
  }

  return errors;
}

/** Submission IDs are short, human-quotable, and stable once issued. */
export function formatSubmissionRef(hackathonSlug: string, ordinal: number): string {
  const prefix = (hackathonSlug || "RJ").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase();
  return `${prefix || "RJ"}-${String(ordinal).padStart(4, "0")}`;
}
