import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
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
import { ArrowUpDown, CheckCircle2, CircleDashed, PenLine } from "lucide-react";

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
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
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
        <div className="nb-inset px-6 py-10 text-center text-sm font-semibold uppercase tracking-widest">
          Loading your assignments…
        </div>
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
        <StatTile label="Assigned" value={summary.total} tone="ink" />
        <StatTile label="Submitted" value={summary.submitted} tone="surface" />
        <StatTile label="In progress" value={summary.inProgress} />
        <StatTile label="Not started" value={summary.notStarted} />
      </div>

      <SectionCard
        title="Review queue"
        description="Open a team to read their submission and complete your scorecard."
        actions={
          <div className="flex flex-wrap gap-2">
            {(["all", "todo", "done"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`border-2 border-ink px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  filter === key ? "bg-ink text-white" : "bg-surface hover:bg-accent"
                }`}
              >
                {key === "all" ? "All" : key === "todo" ? "Outstanding" : "Submitted"}
              </button>
            ))}
          </div>
        }
      >
        <div className="mb-5">
          <BlockProgress
            done={summary.submitted}
            total={summary.total}
            label="Your review progress"
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing here"
            description={
              summary.total === 0
                ? "You have not been assigned any teams for this round yet."
                : "No teams match this filter."
            }
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => setSortByName((v) => !v)}
                      className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest hover:text-muted-foreground"
                    >
                      Team
                      <ArrowUpDown className="size-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest">
                    Track
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest">
                    Submission
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest">
                    Your progress
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest">
                    Due
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-widest">
                    Action
                  </th>
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
                    <tr
                      key={row.assignmentId}
                      className="border-b border-ink/20 align-middle last:border-b-0 hover:bg-accent/40"
                    >
                      <td className="px-3 py-3">
                        <p className="font-bold leading-tight">{row.teamName}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.projectName}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span className="border-2 border-ink bg-surface px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                          {row.trackName}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {submissionTone ? (
                          <StatusBadge tone={submissionTone} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={assignmentTone} />
                          {row.isFinal ? (
                            <CheckCircle2 className="size-4 text-[#1f9d55]" />
                          ) : row.hasScore ? (
                            <PenLine className="size-4 text-[#f08c00]" />
                          ) : (
                            <CircleDashed className="size-4 text-muted-foreground" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs font-semibold text-muted-foreground">
                        {formatRelativeDue(row.dueAt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          to={`/judge/teams/${row.teamId}`}
                          className="nb-press inline-flex h-8 items-center border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
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

        <p className="mt-5 border-t-2 border-ink pt-4 text-[11px] leading-snug text-muted-foreground">
          Once you submit a scorecard it is locked and cannot be edited. Other
          judges' scores for the same team are never shown to you.
        </p>
      </SectionCard>
    </AppShell>
  );
}
