import { Link } from "react-router";
import {
  ArrowRight,
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
  { name: "Innovation", weight: 25, max: 10 },
  { name: "Technical Execution", weight: 30, max: 10 },
  { name: "Impact", weight: 25, max: 10 },
  { name: "Product Design", weight: 20, max: 10 },
];

export default function Landing() {
  const { isAuthenticated, role } = useSession();

  // Signed-in visitors go straight to the area their role owns.
  const primary = isAuthenticated && role ? (
    <Link
      to={ROLE_HOME[role]}
      className="nb-press inline-flex h-11 items-center gap-2 border-2 border-ink bg-primary px-5 text-sm font-bold uppercase tracking-wide text-primary-foreground"
    >
      Open my dashboard
      <ArrowRight className="size-4" />
    </Link>
  ) : (
    <Link
      to="/auth"
      className="nb-press inline-flex h-11 items-center gap-2 border-2 border-ink bg-primary px-5 text-sm font-bold uppercase tracking-wide text-primary-foreground"
    >
      Sign in to judge
      <ArrowRight className="size-4" />
    </Link>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center border-2 border-ink bg-[#ffe500] text-sm font-black">
              RJ
            </span>
            <span className="text-base font-black tracking-tight">
              RaptureJudge
            </span>
          </div>
          <nav className="flex items-center gap-2">
            <a
              href="#roles"
              className="hidden border-2 border-ink bg-surface px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-accent sm:block"
            >
              Roles
            </a>
            <a
              href="#principle"
              className="hidden border-2 border-ink bg-surface px-3 py-2 text-xs font-bold uppercase tracking-wider hover:bg-accent sm:block"
            >
              AI principle
            </a>
            {primary}
          </nav>
        </div>
      </header>

      {/* Compact hero: the product is the dashboard, not a marketing splash. */}
      <section className="border-b-2 border-ink bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-20">
          <div>
            <span className="inline-block border-2 border-ink bg-[#ffe500] px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest">
              Rapture 2026 · National final
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.02] tracking-tight sm:text-5xl lg:text-6xl">
              Hackathon judging
              <br />
              you can defend.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              One platform for submissions, weighted scorecards and result
              publication. Every judge sees a private queue, every score is
              attributable, and no score is ever written by a machine.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {primary}
              <a
                href="#principle"
                className="nb-press inline-flex h-11 items-center gap-2 border-2 border-ink bg-surface px-5 text-sm font-bold uppercase tracking-wide hover:bg-accent"
              >
                How scoring works
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Three demo accounts are available on the sign-in screen — admin,
              judge and participant.
            </p>
          </div>

          {/* A miniature of the judge's queue, drawn with flat blocks. */}
          <div className="nb-card bg-surface p-0">
            <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2.5 text-white">
              <span className="text-[11px] font-bold uppercase tracking-widest">
                Judge queue
              </span>
              <span className="border-2 border-white px-1.5 text-[10px] font-bold uppercase tracking-wider">
                3 of 9 done
              </span>
            </div>
            <div className="divide-y-2 divide-ink/15">
              {[
                ["Team Nebula", "Health Tech", "In progress", "#ffe500"],
                ["Team Quartz", "Climate", "Submitted", "#1f9d55"],
                ["Team Basalt", "Fintech", "Not started", "#ffffff"],
                ["Team Cobalt", "Civic", "Not started", "#ffffff"],
              ].map(([name, track, status, colour]) => (
                <div key={name} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold leading-tight">
                      {name}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {track}
                    </p>
                  </div>
                  <span
                    className="border-2 border-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: colour }}
                  >
                    {status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="roles" className="border-b-2 border-ink">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
            Three roles, three surfaces
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Access is enforced on the server for every read and every write, so
            the boundaries below hold regardless of what a browser requests.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {ROLES.map((entry) => {
              const Icon = entry.icon;
              return (
                <article key={entry.role} className="nb-card flex flex-col p-6">
                  <div className="flex size-11 items-center justify-center border-2 border-ink bg-[#ffe500]">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-black tracking-tight">
                    {entry.title}
                  </h3>
                  <ul className="mt-3 flex-1 space-y-2">
                    {entry.can.map((item) => (
                      <li key={item} className="flex gap-2 text-sm leading-snug">
                        <span aria-hidden className="font-black text-[#1f9d55]">
                          ✓
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t-2 border-ink pt-3 text-xs leading-snug text-muted-foreground">
                    {entry.cannot}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="principle" className="border-b-2 border-ink bg-ink text-white">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <span className="inline-flex items-center gap-2 border-2 border-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest">
                <ShieldCheck className="size-3.5" />
                Product principle
              </span>
              <h2 className="mt-5 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                AI assists the judge. It never makes the call.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-white/80">
                Every submission gets a machine-written briefing to speed up a
                judge's read. It is labelled advisory, it carries no score, and
                it is stored in a field that no scoring function is allowed to
                read.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "A score can only ever be written by the judge it belongs to.",
                  "Submitted scorecards are immutable — no silent revisions.",
                  "A judge's draft is private; colleagues never see it.",
                  "Standings use finalized scorecards only.",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-snug">
                    <Lock className="mt-0.5 size-4 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-2 border-white">
              <div className="border-b-2 border-white bg-[#2b6be4] px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest">
                Shared scoring rubric
              </div>
              <ul>
                {RUBRIC.map((criterion) => (
                  <li
                    key={criterion.name}
                    className="flex items-center gap-4 border-b-2 border-white/20 px-4 py-3 last:border-b-0"
                  >
                    <span className="w-40 shrink-0 text-sm font-bold">
                      {criterion.name}
                    </span>
                    <span className="h-4 flex-1 border-2 border-white">
                      <span
                        className="block h-full bg-[#ffe500]"
                        style={{ width: `${criterion.weight * 4}%` }}
                      />
                    </span>
                    <span className="tabular w-16 shrink-0 text-right text-sm font-black">
                      {criterion.weight}%
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t-2 border-white px-4 py-3 text-xs leading-relaxed text-white/70">
                Weighted to 100 so totals are directly comparable across judges,
                however many teams each of them reviews.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#ffe500]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight">
              Ready to run your round?
            </h2>
            <p className="mt-1.5 text-sm">
              Sign in with the account your organizer issued.
            </p>
          </div>
          {primary}
        </div>
      </section>

      <footer className="border-t-2 border-ink bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold uppercase tracking-widest">
            RaptureJudge · Rapture 2026
          </p>
          <p className="text-xs text-muted-foreground">
            Built for organizers who have to defend every score.
          </p>
        </div>
      </footer>
    </div>
  );
}
