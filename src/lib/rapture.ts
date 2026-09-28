export type AppRole = "admin" | "judge" | "participant";

/** Shared demo password for every seeded account. */
export const DEMO_PASSWORD = "rapture2026";

/**
 * The three accounts to demo the role boundaries. These are created by
 * `src/convex/seed.ts`; keeping the list in one place means the sign-in screen
 * can never drift from what was actually seeded.
 */
export const DEMO_ACCOUNTS: {
  role: AppRole;
  name: string;
  email: string;
  blurb: string;
}[] = [
  {
    role: "admin",
    name: "Aditi Raghunathan",
    email: "aditi@rapturejudge.io",
    blurb: "Full oversight: every team, every scorecard, judge workload.",
  },
  {
    role: "judge",
    name: "Dr. Elena Vasquez",
    email: "elena@rapturejudge.io",
    blurb: "Only her assigned teams, and only her own scorecards.",
  },
  {
    role: "participant",
    name: "Nikhil Okafor",
    email: "nikhil.okafor@rapture.dev",
    blurb: "Team Nebula only — their own submission, no scores.",
  },
];

export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  judge: "/judge",
  participant: "/participant",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  judge: "Judge",
  participant: "Participant",
};

export type NavItem = { label: string; href: string };

/** Navigation is derived from the role, so a user never sees a link they
 *  cannot use, and a forged URL still hits the server-side guard. */
export const ROLE_NAV: Record<AppRole, NavItem[]> = {
  admin: [
    { label: "Oversight", href: "/admin" },
    { label: "Hackathon", href: "/admin/hackathon" },
    { label: "Rubric", href: "/admin/rubric" },
    { label: "Judges", href: "/admin/judges" },
    { label: "Teams", href: "/admin/teams" },
    { label: "Audit log", href: "/admin/audit" },
  ],
  judge: [{ label: "My Teams", href: "/judge" }],
  participant: [
    { label: "Dashboard", href: "/participant" },
    { label: "My Team", href: "/participant/team" },
    { label: "Submission", href: "/participant/submission" },
  ],
};

export type Tone = {
  label: string;
  className: string;
};

// Status colour is drawn from the semantic tokens in index.css so a state looks
// identical everywhere it appears — badge, banner, or chart legend.
const NEUTRAL = "bg-muted text-muted-foreground";
const INFO = "bg-info-soft text-info-foreground";
const WARN = "bg-warning-soft text-warning-foreground";
const OK = "bg-success-soft text-success-foreground";
const BAD = "bg-danger-soft text-danger-foreground";

export const ASSIGNMENT_TONE: Record<string, Tone> = {
  not_started: { label: "Not started", className: NEUTRAL },
  in_progress: { label: "In progress", className: WARN },
  submitted: { label: "Submitted", className: OK },
};

export const SUBMISSION_TONE: Record<string, Tone> = {
  draft: { label: "Draft", className: NEUTRAL },
  submitted: { label: "Submitted", className: INFO },
  under_review: { label: "Under review", className: WARN },
  scored: { label: "Scored", className: OK },
};

export const HACKATHON_TONE: Record<string, Tone> = {
  registration: { label: "Registration", className: NEUTRAL },
  build: { label: "Build phase", className: INFO },
  submissions_closed: { label: "Submissions closed", className: WARN },
  judging: { label: "Judging", className: WARN },
  results: { label: "Results", className: OK },
};

export const RECOMMENDATION_TONE: Record<string, Tone> = {
  advance: { label: "Advance", className: OK },
  hold: { label: "Hold", className: WARN },
  reject: { label: "Do not advance", className: BAD },
};

export function formatDate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Relative day count, used for "due in 2 days" style deadlines. */
export function formatRelativeDue(dueAt: number): string {
  const diffDays = Math.round((dueAt - Date.now()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays}d`;
}

/** `datetime-local` needs a local-time string, not an epoch. */
export function toDateTimeLocal(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Audit-log action tokens mapped to a human label and a tone. */
export const AUDIT_ACTION: Record<string, { label: string; tone: Tone }> = {
  "hackathon.created": { label: "Hackathon created", tone: { label: "", className: "bg-info-soft text-info-foreground" } },
  "hackathon.updated": { label: "Hackathon edited", tone: { label: "", className: "bg-info-soft text-info-foreground" } },
  "hackathon.set_current": { label: "Live hackathon changed", tone: { label: "", className: "bg-info-soft text-info-foreground" } },
  "settings.toggled": { label: "Setting changed", tone: { label: "", className: "bg-warning-soft text-warning-foreground" } },
  "results.published": { label: "Results published", tone: { label: "", className: "bg-success-soft text-success-foreground" } },
  "results.unpublished": { label: "Results unpublished", tone: { label: "", className: "bg-warning-soft text-warning-foreground" } },
  "rubric.criterion_created": { label: "Criterion added", tone: { label: "", className: "bg-success-soft text-success-foreground" } },
  "rubric.criterion_updated": { label: "Criterion edited", tone: { label: "", className: "bg-info-soft text-info-foreground" } },
  "rubric.criterion_deleted": { label: "Criterion removed", tone: { label: "", className: "bg-danger-soft text-danger-foreground" } },
  "rubric.criterion_reordered": { label: "Criterion reordered", tone: { label: "", className: "bg-muted text-muted-foreground" } },
  "judge.created": { label: "Judge added", tone: { label: "", className: "bg-success-soft text-success-foreground" } },
  "judge.updated": { label: "Judge edited", tone: { label: "", className: "bg-info-soft text-info-foreground" } },
  "judge.activated": { label: "Judge activated", tone: { label: "", className: "bg-success-soft text-success-foreground" } },
  "judge.deactivated": { label: "Judge deactivated", tone: { label: "", className: "bg-warning-soft text-warning-foreground" } },
  "assignment.created": { label: "Judge assigned", tone: { label: "", className: "bg-success-soft text-success-foreground" } },
  "assignment.removed": { label: "Judge unassigned", tone: { label: "", className: "bg-warning-soft text-warning-foreground" } },
  "conflict.declared": { label: "Conflict declared", tone: { label: "", className: "bg-danger-soft text-danger-foreground" } },
  "conflict.resolved": { label: "Conflict resolved", tone: { label: "", className: "bg-muted text-muted-foreground" } },
  "score.submitted": { label: "Scorecard submitted", tone: { label: "", className: "bg-muted text-muted-foreground" } },
};

export function auditTone(action: string): Tone {
  return (
    AUDIT_ACTION[action]?.tone ?? {
      label: action,
      className: "bg-muted text-muted-foreground",
    }
  );
}

export function auditLabel(action: string): string {
  return AUDIT_ACTION[action]?.label ?? action;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
