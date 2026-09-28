import { Link } from "react-router";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Gavel,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { ROLE_HOME, type AppRole } from "@/lib/rapture";

const ROLES: {
  role: AppRole;
  icon: typeof Users;
  title: string;
  can: string[];
  cannot: string;
}[] = [
  {
    role: "admin",
    icon: ClipboardCheck,
    title: "Admins",
    can: [
      "Oversee every team, judge and scorecard",
      "Watch judging progress and workload in real time",
      "See coverage gaps before results are computed",
    ],
    cannot: "Cannot alter a judge's score — oversight is read-only.",
  },
  {
    role: "judge",
    icon: Gavel,
    title: "Judges",
    can: [
      "See only the teams assigned to them",
      "Work a weighted rubric with private drafts",
      "Lock a scorecard on submit",
    ],
    cannot: "Cannot see other judges' scores, or any admin tooling.",
  },
  {
    role: "participant",
    icon: Users,
    title: "Participants",
    can: [
      "See only their own team and submission",
      "Edit and lock a submission before the deadline",
      "Track judging progress without seeing scores",
    ],
    cannot: "Cannot browse other teams, or any score before results publish.",
  },
];

const RUBRIC = [
  { name: "Innovation", weight: 25 },
  { name: "Technical Execution", weight: 30 },
  { name: "Impact", weight: 25 },
  { name: "Product Design", weight: 20 },
];

const GUARANTEES = [
  "A score can only ever be written by the judge it belongs to.",
  "Submitted scorecards are immutable — no silent revisions.",
  "A judge's draft is private; colleagues never see it.",
  "Standings use finalized scorecards only.",
];

const QUEUE = [
  { team: "Team Nebula", track: "Health Tech", state: "In progress", tone: "warn" },
  { team: "Team Ferrous", track: "Dev Tools", state: "Submitted", tone: "ok" },
  { team: "Team Basalt", track: "Fintech", state: "Not started", tone: "idle" },
  { team: "Team Cobalt", track: "Civic", state: "Not started", tone: "idle" },
] as const;

const TONE_CLASS = {
  warn: "bg-warning-soft text-warning-foreground",
  ok: "bg-success-soft text-success-foreground",
  idle: "bg-muted text-muted-foreground",
} as const;

export default function Landing() {
  const { isAuthenticated, role } = useSession();

  // Signed-in visitors go straight to the area their role owns.
  const primary = (
    <Link
      to={isAuthenticated && role ? ROLE_HOME[role] : "/auth"}
      className="btn-base btn-primary btn-lg"
    >
      {isAuthenticated && role ? "Open my dashboard" : "Sign in to judge"}
      <ArrowRight />
    </Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              RJ
            </span>
            <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">
              RaptureJudge
            </span>
          </div>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#roles"
              className="btn-base btn-ghost btn-sm hidden sm:inline-flex"
            >
              Roles
            </a>
            <a
              href="#principle"
              className="btn-base btn-ghost btn-sm hidden sm:inline-flex"
            >
              AI principle
            </a>
            {primary}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero — compact and product-led, not a marketing splash. */}
        <section className="border-b border-border bg-card">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
            <div>
              <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                Rapture 2026 · National final
              </span>
              <h1 className="mt-6 text-4xl leading-[1.06] font-semibold tracking-[-0.03em] sm:text-5xl">
                Hackathon judging you can actually defend.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground">
                One platform for submissions, weighted scorecards and result
                publication. Every judge gets a private queue, every score is
                attributable, and no score is ever written by a machine.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {primary}
                <a href="#principle" className="btn-base btn-outline btn-lg">
                  How scoring works
                </a>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Three demo accounts on the sign-in screen — admin, judge and
                participant.
              </p>
            </div>

            {/* A faithful miniature of the judge's queue. */}
            <div className="surface-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border bg-secondary px-4 py-2.5">
                <span className="text-xs font-semibold text-secondary-foreground">
                  Judge queue
                </span>
                <span className="rounded-full bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                  1 of 2 submitted
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {QUEUE.map((row) => (
                    <tr key={row.team}>
                      <td className="px-4 py-3">
                        <p className="font-medium leading-tight">{row.team}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.track}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`status-pill ${TONE_CLASS[row.tone]}`}
                        >
                          {row.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-border bg-muted px-4 py-2.5 text-[0.6875rem] text-muted-foreground">
                Judges see only their assigned teams. Other judges' scores are
                never returned to this client.
              </p>
            </div>
          </div>
        </section>

        <section id="roles" className="border-b border-border">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-[-0.021em] sm:text-3xl">
              Three roles, three surfaces
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Access is enforced on the server for every read and every write, so
              these boundaries hold regardless of what a browser requests.
            </p>

            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {ROLES.map((entry) => {
                const Icon = entry.icon;
                return (
                  <article key={entry.role} className="surface-card flex flex-col p-6">
                    <div className="flex size-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold tracking-[-0.015em]">
                      {entry.title}
                    </h3>
                    <ul className="mt-3 flex-1 space-y-2">
                      {entry.can.map((item) => (
                        <li
                          key={item}
                          className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground"
                        >
                          <Check className="mt-0.5 size-4 shrink-0 text-success" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                      {entry.cannot}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="principle" className="border-b border-border bg-primary text-primary-foreground">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                <ShieldCheck className="size-3.5" />
                Product principle
              </span>
              <h2 className="mt-5 text-2xl leading-tight font-semibold tracking-[-0.025em] sm:text-3xl">
                AI assists the judge. It never makes the call.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-primary-foreground/80">
                Every submission gets a machine-written briefing to speed up a
                judge's read. It is labelled advisory, it carries no score, and
                it is stored in a field that no scoring function is allowed to
                read.
              </p>
              <ul className="mt-6 space-y-2.5">
                {GUARANTEES.map((item) => (
                  <li
                    key={item}
                    className="flex gap-2.5 text-sm leading-relaxed text-primary-foreground/85"
                  >
                    <Lock className="mt-0.5 size-4 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-white/20 bg-white/5">
              <div className="border-b border-white/20 px-5 py-3 text-xs font-semibold">
                Shared scoring rubric
              </div>
              <ul className="px-5 py-2">
                {RUBRIC.map((criterion) => (
                  <li
                    key={criterion.name}
                    className="flex items-center gap-4 border-b border-white/10 py-3 last:border-b-0"
                  >
                    <span className="w-40 shrink-0 text-sm">
                      {criterion.name}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
                      <span
                        className="block h-full rounded-full bg-[#ffe500]"
                        style={{ width: `${criterion.weight * 3.2}%` }}
                      />
                    </span>
                    <span className="tabular w-12 shrink-0 text-right text-sm font-semibold">
                      {criterion.weight}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-white/20 px-5 py-3 text-xs leading-relaxed text-primary-foreground/70">
                Weighted to 100 so totals are directly comparable across judges,
                however many teams each of them reviews.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-accent">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-14 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.021em] text-accent-foreground">
                Ready to run your round?
              </h2>
              <p className="mt-1.5 text-sm text-accent-foreground/70">
                Sign in with the account your organizer issued.
              </p>
            </div>
            {primary}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            RaptureJudge · Rapture 2026
          </p>
          <p className="text-xs text-muted-foreground">
            Built for organizers who have to stand behind every score.
          </p>
        </div>
      </footer>
    </div>
  );
}
