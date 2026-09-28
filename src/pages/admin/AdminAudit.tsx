import { useState } from "react";
import { useQuery } from "convex/react";
import { History } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { auditLabel, auditTone, formatDateTime } from "@/lib/rapture";
import { cn } from "@/lib/utils";

/**
 * Read-only audit trail.
 *
 * Entries are written by `lib/audit.ts` and are never editable or deletable
 * from the product, which is the point of having them.
 */
export default function AdminAudit() {
  const data = useQuery(api.audit.listForAdmin, {});
  const actions = useQuery(api.audit.actions, {});
  const [filter, setFilter] = useState<string>("all");

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading audit log…
        </div>
      </AppShell>
    );
  }

  const entries =
    filter === "all"
      ? data.entries
      : data.entries.filter((entry) => entry.action === filter);

  return (
    <AppShell role="admin">
      <PageHeader
        title="Audit log"
        description={`Every administrative action, newest first. ${data.total} recorded. Append-only — entries cannot be edited or removed.`}
      />

      <SectionCard
        title="Activity"
        actions={
          <select
            value={filter}
            aria-label="Filter by action"
            onChange={(event) => setFilter(event.target.value)}
            className="h-8 rounded-md border border-input bg-card px-2.5 text-xs font-medium text-foreground"
          >
            <option value="all">All actions</option>
            {(actions ?? []).map((action) => (
              <option key={action} value={action}>
                {auditLabel(action)}
              </option>
            ))}
          </select>
        }
      >
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded"
            description={
              filter === "all"
                ? "Administrative actions will appear here as they happen."
                : "No entries of this type yet."
            }
          />
        ) : (
          <ol className="space-y-0">
            {entries.map((entry) => (
              <li
                key={entry._id}
                className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-border py-3.5 first:pt-0 last:border-b-0"
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <History className="size-3.5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={auditTone(entry.action)}>
                      {auditLabel(entry.action)}
                    </StatusBadge>
                    {entry.targetLabel && (
                      <span className="text-sm font-medium">
                        {entry.targetLabel}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.actorName}
                    {entry.metadata?.summary && ` · ${entry.metadata.summary}`}
                  </p>
                </div>
                <time className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard
        className="mt-5"
        title="What gets recorded"
        description="Coverage of the audit trail."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            "Hackathon created or edited",
            "Phase switches and blind-judging changes",
            "Results published or unpublished",
            "Rubric criteria added, edited, removed or reordered",
            "Judges added, edited, activated or deactivated",
            "Judge assignments created and removed",
            "Conflicts of interest declared and resolved",
            "Scorecards finalized by a judge",
          ].map((item) => (
            <p
              key={item}
              className={cn(
                "rounded-md border border-border bg-card px-3 py-2.5 text-xs leading-relaxed text-muted-foreground",
              )}
            >
              {item}
            </p>
          ))}
        </div>
      </SectionCard>
    </AppShell>
  );
}
