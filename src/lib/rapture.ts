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
    { label: "Teams", href: "/admin/teams" },
  ],
  judge: [{ label: "My Teams", href: "/judge" }],
  participant: [{ label: "My Team", href: "/participant" }],
};

export type Tone = {
  label: string;
  className: string;
};

const NEUTRAL = "bg-surface text-ink";
const YELLOW = "bg-[#ffe500] text-ink";
const BLUE = "bg-[#2b6be4] text-white";
const GREEN = "bg-[#1f9d55] text-white";
const RED = "bg-[#d8382a] text-white";
const GREY = "bg-[#c9c9c1] text-ink";

export const ASSIGNMENT_TONE: Record<string, Tone> = {
  not_started: { label: "Not started", className: NEUTRAL },
  in_progress: { label: "In progress", className: YELLOW },
  submitted: { label: "Submitted", className: GREEN },
};

export const SUBMISSION_TONE: Record<string, Tone> = {
  draft: { label: "Draft", className: GREY },
  submitted: { label: "Submitted", className: BLUE },
  under_review: { label: "Under review", className: YELLOW },
  scored: { label: "Scored", className: GREEN },
};

export const HACKATHON_TONE: Record<string, Tone> = {
  registration: { label: "Registration", className: NEUTRAL },
  build: { label: "Build phase", className: BLUE },
  submissions_closed: { label: "Submissions closed", className: YELLOW },
  judging: { label: "Judging", className: YELLOW },
  results: { label: "Results", className: GREEN },
};

export const RECOMMENDATION_TONE: Record<string, Tone> = {
  advance: { label: "Advance", className: GREEN },
  hold: { label: "Hold", className: YELLOW },
  reject: { label: "Do not advance", className: RED },
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

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
