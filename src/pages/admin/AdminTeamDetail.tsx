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
  const data = useQuery(api.teams.adminTeamDetail, team ? { teamId: team } : "skip");

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading team…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="admin">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">Team not found</h1>
          <Link to="/admin/teams" className="btn-base btn-primary mt-5">
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
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All teams
      </Link>

      <PageHeader
        title={data.team.projectName}
        description={`${data.team.name} — ${data.team.tagline}`}
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
        <StatTile label="Track" value={data.team.trackName} tone="primary" />
        <StatTile label="Members" value={data.members.length} />
        <StatTile
          label="Scorecards"
          value={`${finals.length} / ${data.scorecards.length}`}
          hint="final of total"
        />
        <StatTile
          label="Average"
          value={average ?? "—"}
          tone={average ? "accent" : "surface"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5">
          <SectionCard title="Submission">
            <p className="text-sm leading-relaxed">{data.submission?.abstract}</p>
            {data.submission?.highlights.length ? (
              <ul className="mt-4 space-y-1.5">
                {data.submission.highlights.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
                    <span aria-hidden className="font-medium text-primary">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {data.team.demoUrl && (
                <a
                  href={data.team.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Demo <ExternalLink />
                </a>
              )}
              {data.team.repoUrl && (
                <a
                  href={data.team.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Repository <ExternalLink />
                </a>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Roster">
            <ul className="divide-y divide-border">
              {data.members.map((member) => (
                <li
                  key={member.email}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span>
                    <span className="text-sm font-medium">{member.name}</span>
                    {member.isLead && (
                      <span className="ml-2 rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-semibold text-accent-foreground">
                        Lead
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
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
            <div className="space-y-3">
              {data.scorecards.map((card, index) => (
                <article
                  key={`${card.judgeName}-${index}`}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                    <div>
                      <p className="text-sm font-medium">{card.judgeName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
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
                      <span className="tabular rounded-md bg-secondary px-2 py-0.5 text-sm font-semibold text-foreground">
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
                        <dt className="text-xs text-muted-foreground">
                          {criterion.name}
                        </dt>
                        <dd className="tabular text-xs font-medium">
                          {card.breakdown[criterion.name] ?? "–"}/
                          {criterion.maxScore}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {card.comments && (
                    <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
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
