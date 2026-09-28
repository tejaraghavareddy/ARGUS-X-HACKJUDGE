import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import {
  RECOMMENDATION_TONE,
  SUBMISSION_TONE,
  formatDate,
} from "@/lib/rapture";

/**
 * Admin view of a single team, including every scorecard.
 *
 * Admins can *read* scorecards for oversight and moderation, but there is no
 * write path here: an admin cannot alter a judge's score, by design.
 */
export default function AdminTeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const team = teamId ? (teamId as Id<"teams">) : null;
  const data = useQuery(
    api.teams.adminTeamDetail,
    team ? { teamId: team } : "skip",
  );

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="nb-inset px-6 py-10 text-center text-sm font-semibold uppercase tracking-widest">
          Loading team…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="admin">
        <div className="nb-card p-8">
          <h1 className="text-xl font-black">Team not found</h1>
          <Link
            to="/admin/teams"
            className="nb-press mt-5 inline-flex h-10 items-center border-2 border-ink bg-primary px-4 text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          >
            Back to teams
          </Link>
        </div>
      </AppShell>
    );
  }

  const finals = data.scorecards.filter((s) => s.isFinal);
  const average = finals.length
    ? (
        finals.reduce((sum, s) => sum + s.totalScore, 0) / finals.length
      ).toFixed(1)
    : null;

  return (
    <AppShell role="admin">
      <Link
        to="/admin/teams"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        All teams
      </Link>

      <PageHeader
        title={data.team.projectName}
        description={`${data.team.name} · ${data.team.tagline}`}
        actions={
          data.submission ? (
            <StatusBadge
              tone={
                SUBMISSION_TONE[data.submission.status] ??
                SUBMISSION_TONE.draft
              }
            />
          ) : null
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Track" value={data.team.trackName} tone="ink" />
        <StatTile label="Members" value={data.members.length} />
        <StatTile
          label="Scorecards"
          value={`${finals.length}/${data.scorecards.length}`}
          hint="final / total"
        />
        <StatTile
          label="Average"
          value={average ?? "—"}
          tone={average ? "accent" : "surface"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr] lg:items-start">
        <div className="space-y-5">
          <SectionCard title="Submission">
            <p className="text-sm leading-relaxed">{data.submission?.abstract}</p>
            {data.submission?.highlights.length ? (
              <ul className="mt-4 space-y-1.5">
                {data.submission.highlights.map((item) => (
                  <li key={item} className="flex gap-2 text-sm">
                    <span aria-hidden className="font-black">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2 border-t-2 border-ink pt-4">
              {data.team.demoUrl && (
                <a
                  href={data.team.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nb-press inline-flex h-9 items-center gap-2 border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
                >
                  Demo <ExternalLink className="size-3.5" />
                </a>
              )}
              {data.team.repoUrl && (
                <a
                  href={data.team.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nb-press inline-flex h-9 items-center gap-2 border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
                >
                  Repository <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Roster">
            <ul className="space-y-2">
              {data.members.map((member) => (
                <li
                  key={member.email}
                  className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink bg-surface px-3 py-2"
                >
                  <span>
                    <span className="text-sm font-bold">{member.name}</span>
                    {member.isLead && (
                      <span className="ml-2 border-2 border-ink bg-[#ffe500] px-1.5 text-[10px] font-bold uppercase tracking-wider">
                        Lead
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {member.role}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <AdvisoryPanel review={data.submission?.aiReview} audience="judge" />
        </div>

        <SectionCard
          title="Scorecards"
          description="Every judge's submission, highest first. Read-only for admins."
        >
          {data.scorecards.length === 0 ? (
            <EmptyState
              title="No scorecards yet"
              description="Judges assigned to this team have not filed their scorecards."
            />
          ) : (
            <div className="space-y-4">
              {data.scorecards.map((card) => (
                <article key={`${card.judgeName}-${card.submittedAt}`} className="nb-flat p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink pb-3">
                    <div>
                      <p className="text-sm font-bold">{card.judgeName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {card.isFinal
                          ? `Submitted ${formatDate(card.submittedAt)}`
                          : "Draft — not counted in standings"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        tone={
                          RECOMMENDATION_TONE[card.recommendation] ??
                          RECOMMENDATION_TONE.hold
                        }
                      />
                      <span className="tabular border-2 border-ink bg-ink px-2 py-0.5 text-sm font-black text-white">
                        {card.totalScore}
                      </span>
                    </div>
                  </div>

                  <dl className="mt-3 space-y-1.5">
                    {data.criteria.map((criterion) => (
                      <div
                        key={criterion.name}
                        className="flex items-center justify-between gap-3"
                      >
                        <dt className="text-xs font-semibold">
                          {criterion.name}
                        </dt>
                        <dd className="tabular text-xs font-bold">
                          {card.breakdown[criterion.name] ?? "–"}
                          /{criterion.maxScore}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {card.comments && (
                    <p className="mt-3 border-t-2 border-ink pt-3 text-xs leading-relaxed text-muted-foreground">
                      {card.comments}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
