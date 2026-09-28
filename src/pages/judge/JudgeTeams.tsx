import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import { ArrowUpDown, CheckCircle2, CircleDashed, PenLine } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import {
  ASSIGNMENT_TONE,
  SUBMISSION_TONE,
  formatRelativeDue,
} from "@/lib/rapture";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Outstanding" },
  { key: "done", label: "Submitted" },
] as const;

/**
 * The judge's main screen: every team assigned to them, in one table.
 *
 * Desktop-first because that is how judging actually happens — a judge works
 * down a list on a laptop. The table carries the four things needed to triage
 * without opening anything: track, submission state, their own progress, and
 * the deadline.
 */
export default function JudgeTeams() {
  const data = useQuery(api.judging.myAssignments);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [sortByName, setSortByName] = useState(false);

  const rows = useMemo(() => {
    const list = data?.assignments ?? [];
    const filtered = list.filter((row) => {
      if (filter === "todo") return row.status !== "submitted";
      if (filter === "done") return row.status === "submitted";
      return true;
    });
    return sortByName
      ? [...filtered].sort((a, b) => a.teamName.localeCompare(b.teamName))
      : filtered;
  }, [data, filter, sortByName]);

  if (data === undefined) {
    return (
      <AppShell role="judge">
        <Loading label="Loading your assignments…" />
      </AppShell>
    );
  }

  const { summary } = data;

  return (
    <AppShell role="judge">
      <PageHeader
        title="My assigned teams"
        description="Everything assigned to you for this round. You see only your own teams, and only your own scorecards."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Assigned" value={summary.total} tone="primary" />
        <StatTile label="Submitted" value={summary.submitted} />
        <StatTile label="In progress" value={summary.inProgress} />
        <StatTile label="Not started" value={summary.notStarted} />
      </div>

      <SectionCard
        title="Review queue"
        description="Open a team to read their submission and complete your scorecard."
        actions={
          <div className="flex rounded-md border border-input bg-card p-0.5">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setFilter(option.key)}
                aria-pressed={filter === option.key}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === option.key
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-5 max-w-md">
          <BlockProgress
            done={summary.submitted}
            total={summary.total}
            label="Your review progress"
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description={
              summary.total === 0
                ? "You have not been assigned any teams for this round yet."
                : "No teams match this filter."
            }
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-[26%]">
                    <button
                      type="button"
                      onClick={() => setSortByName((v) => !v)}
                      className="flex items-center gap-1.5 transition-colors hover:text-foreground"
                    >
                      Team
                      <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th>Track</th>
                  <th>Submission</th>
                  <th>Your progress</th>
                  <th>Due</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const assignmentTone =
                    ASSIGNMENT_TONE[row.status] ?? ASSIGNMENT_TONE.not_started;
                  const submissionTone = row.submissionStatus
                    ? SUBMISSION_TONE[row.submissionStatus]
                    : null;

                  return (
                    <tr key={row.assignmentId}>
                      <td>
                        <p className="font-medium leading-tight">{row.teamName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.projectName}
                        </p>
                      </td>
                      <td>
                        <span className="text-sm text-muted-foreground">
                          {row.trackName}
                        </span>
                      </td>
                      <td>
                        {submissionTone ? (
                          <StatusBadge tone={submissionTone} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={assignmentTone} />
                          {row.isFinal ? (
                            <CheckCircle2
                              className="size-4 text-success"
                              aria-label="Scorecard locked"
                            />
                          ) : row.hasScore ? (
                            <PenLine
                              className="size-4 text-warning"
                              aria-label="Draft in progress"
                            />
                          ) : (
                            <CircleDashed
                              className="size-4 text-muted-foreground"
                              aria-label="Not started"
                            />
                          )}
                        </div>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {formatRelativeDue(row.dueAt)}
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/judge/teams/${row.teamId}`}
                          className="btn-base btn-outline btn-sm"
                        >
                          {row.isFinal ? "View" : "Review"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          Once you submit a scorecard it is locked and cannot be edited. Other
          judges' scores for the same team are never shown to you.
        </p>
      </SectionCard>
    </AppShell>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
