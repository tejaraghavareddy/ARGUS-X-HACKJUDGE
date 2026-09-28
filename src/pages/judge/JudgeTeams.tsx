import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "convex/react";
import {
  ArrowUpDown,
  CheckCircle2,
  CircleDashed,
  Clock,
  EyeOff,
  FileCheck2,
  FileClock,
  PenLine,
  PlayCircle,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  Countdown,
  EmptyState,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import {
  ASSIGNMENT_TONE,
  SUBMISSION_TONE,
  formatDateTime,
  formatRelativeDue,
} from "@/lib/rapture";
import { cn } from "@/lib/utils";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "todo", label: "Outstanding" },
  { key: "done", label: "Submitted" },
] as const;

/**
 * The judge's home: what is assigned, how far through they are, and what to
 * open next.
 *
 * Desktop-first, because that is how judging actually happens — a judge works
 * down a list on a laptop and should be able to triage the whole queue without
 * opening anything. Everything in the table is either a triage signal or a
 * deadline.
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
      ? [...filtered].sort((a, b) => a.displayName.localeCompare(b.displayName))
      : filtered;
  }, [data, filter, sortByName]);

  if (data === undefined) {
    return (
      <AppShell role="judge">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading your assignments…
        </div>
      </AppShell>
    );
  }

  const { summary, deadline, recentActivity, blindJudging } = data;
  const pending = summary.total - summary.submitted;
  const percent =
    summary.total === 0 ? 0 : Math.round((summary.submitted / summary.total) * 100);

  return (
    <AppShell role="judge">
      <PageHeader
        title="My judging queue"
        description="Only submissions assigned to you appear here, and only your own scorecards are ever visible."
        actions={
          blindJudging ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-info/40 bg-info-soft px-2.5 py-1 text-xs font-medium text-info-foreground">
              <EyeOff className="size-3.5" />
              Blind judging on
            </span>
          ) : null
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Assigned" value={summary.total} tone="primary" />
        <StatTile label="Completed" value={summary.submitted} tone="accent" />
        <StatTile label="Pending" value={pending} />
        <StatTile
          label="Progress"
          value={`${percent}%`}
          hint={`${summary.submitted} of ${summary.total} submitted`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <SectionCard
          title="Assigned submissions"
          description="Open a submission to read it and complete your scorecard."
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
              label="Evaluation progress"
            />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="Nothing to show"
              description={
                summary.total === 0
                  ? "You have not been assigned any submissions for this round yet."
                  : "No submissions match this filter."
              }
            />
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th className="w-[16%]">Submission</th>
                    <th>
                      <button
                        type="button"
                        onClick={() => setSortByName((v) => !v)}
                        className="flex items-center gap-1.5 transition-colors hover:text-foreground"
                      >
                        Project
                        <ArrowUpDown className="size-3" />
                      </button>
                    </th>
                    <th>Status</th>
                    <th>Your evaluation</th>
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
                          <p className="font-mono text-xs font-semibold">
                            {row.submissionRef ?? "—"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.displayName}
                          </p>
                        </td>
                        <td>
                          <p className="font-medium leading-tight">
                            {row.projectName || "Unnamed project"}
                          </p>
                          {!blindJudging && row.tagline && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {row.tagline}
                            </p>
                          )}
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
                            {row.isFinal ? (
                              <>
                                <StatusBadge tone={assignmentTone} />
                                <CheckCircle2
                                  className="size-4 text-success"
                                  aria-label="Scorecard locked"
                                />
                              </>
                            ) : row.hasScore ? (
                              <>
                                <StatusBadge tone={assignmentTone} />
                                <PenLine
                                  className="size-4 text-warning"
                                  aria-label="Draft in progress"
                                />
                              </>
                            ) : (
                              <>
                                <StatusBadge tone={assignmentTone} />
                                <CircleDashed
                                  className="size-4 text-muted-foreground"
                                  aria-label="Not started"
                                />
                              </>
                            )}
                          </div>
                          {!row.isFinal && row.criteriaCount > 0 && (
                            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                              {row.scoredCount}/{row.criteriaCount} criteria scored
                            </p>
                          )}
                        </td>
                        <td className="text-xs text-muted-foreground">
                          {formatRelativeDue(row.dueAt)}
                        </td>
                        <td className="text-right">
                          <Link
                            to={`/judge/teams/${row.teamId}`}
                            className={cn(
                              "btn-base btn-sm",
                              row.isFinal
                                ? "btn-outline"
                                : row.hasScore
                                  ? "btn-outline"
                                  : "btn-primary",
                            )}
                          >
                            {row.isFinal ? (
                              <>
                                <FileCheck2 />
                                View
                              </>
                            ) : row.hasScore ? (
                              <>
                                <PenLine />
                                Continue
                              </>
                            ) : (
                              <>
                                <PlayCircle />
                                Start evaluation
                              </>
                            )}
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
            Once you submit a scorecard it locks permanently. You will never see
            another judge's score for the same submission, and they will never
            see yours.
          </p>
        </SectionCard>

        <div className="space-y-5">
          {deadline && (
            <SectionCard
              title="Judging deadline"
              description={formatDateTime(deadline)}
            >
              <Countdown to={deadline} />
            </SectionCard>
          )}

          <SectionCard
            title="Recent activity"
            description="Your own trail. Other judges' activity is not visible to you."
          >
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet. Open a submission to start your first evaluation.
              </p>
            ) : (
              <ol className="space-y-3">
                {recentActivity.map((item, index) => (
                  <li key={`${item.teamId}-${item.at}-${index}`} className="flex gap-2.5">
                    {item.kind === "submitted" ? (
                      <FileCheck2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <FileClock className="mt-0.5 size-4 shrink-0 text-warning" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm">
                        {item.kind === "submitted" ? (
                          <>
                            Submitted evaluation for{" "}
                            <span className="font-medium">{item.label}</span>
                          </>
                        ) : (
                          <>
                            Saved a draft for{" "}
                            <span className="font-medium">{item.label}</span>
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatRelativeDue(item.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
