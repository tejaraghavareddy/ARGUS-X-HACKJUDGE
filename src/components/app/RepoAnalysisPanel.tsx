import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Github,
  RefreshCw,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { NO_EVIDENCE_DETECTED } from "@/convex/lib/github";

type SectionLike = {
  key: string;
  title: string;
  evidence: { label: string; source: string; detail?: string }[];
  noEvidence: boolean;
};

/**
 * GitHub repository analysis panel.
 *
 * Shows the deterministic technical report for the submission's GitHub
 * repository: detected evidence with the file each item came from, the scan's
 * coverage limits, potential verification steps, and — when the AI narrative
 * layer ran — a short neutral reading, clearly labelled with its model.
 *
 * Advisory only: this panel has no score, writes no score, and never states
 * that a capability is absent. When the analyzer saw nothing for a dimension
 * it says so in the product's fixed wording.
 */
export function RepoAnalysisPanel({ teamId }: { teamId: Id<"teams"> }) {
  const analysis = useQuery(api.repoAnalysis.analysisForSubmission, { teamId });
  const analyze = useAction(api.repoAnalysis.analyze);

  const [busy, setBusy] = useState(false);

  const runAnalysis = async () => {
    setBusy(true);
    try {
      const result = await analyze({ teamId });
      if (result.ok) {
        toast.success(`Analyzed ${result.repoFullName}.`);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not analyze the repository.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (analysis === undefined) {
    return (
      <section className="surface-card p-5">
        <p className="text-sm text-muted-foreground">Loading repository analysis…</p>
      </section>
    );
  }

  if (analysis === null) {
    return null; // no live hackathon — nothing to scope an analysis to
  }

  return (
    <section className="surface-card overflow-hidden" id="repo-analysis">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-info-soft px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-info-foreground">
          <Github className="size-3.5" />
          GitHub repository analysis
        </span>
        <span className="rounded-full bg-card px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
          Advisory only — never a score
        </span>
      </header>

      <div className="p-4">
        <p className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-warning-foreground">
          <ShieldQuestion className="mt-px size-4 shrink-0" />
          <span>
            Deterministic scan of the submission's public repository via the
            GitHub API, kept separate from your scorecard. It shows what the
            analyzer found and where; when it did not find something it says so
            — absence of evidence is not evidence of absence.
          </span>
        </p>

        {analysis.state === "missing" && (
          <div className="surface-inset mt-4 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No repository analysis has been run for this submission yet.
            </p>
            <Button
              onClick={() => void runAnalysis()}
              disabled={busy}
              className="mt-3"
            >
              <FileSearch />
              {busy ? "Analyzing…" : "Analyze Repository"}
            </Button>
            <p className="mt-2 text-[0.6875rem] text-muted-foreground">
              Runs server-side against the GitHub URL the team submitted.
            </p>
          </div>
        )}

        {analysis.state === "failed" && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive-foreground">
              <AlertTriangle className="size-3.5" />
              The last analysis attempt failed
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-destructive-foreground/90">
              {analysis.error}
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void runAnalysis()}
              disabled={busy}
            >
              <RefreshCw />
              {busy ? "Retrying…" : "Retry analysis"}
            </Button>
          </div>
        )}

        {analysis.state === "ready" && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
              {analysis.repoUrl && (
                <a
                  href={analysis.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground transition-colors hover:bg-secondary/80"
                >
                  <Github className="size-3" />
                  {analysis.repoFullName}
                  <ExternalLink className="size-2.5" />
                </a>
              )}
              <span>
                Analyzed {new Date(analysis.fetchedAt).toLocaleString()}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5">
                {analysis.scanCoverage?.treeEntries ?? 0} tree entries ·{" "}
                {analysis.scanCoverage?.filesRead ?? 0} files read
              </span>
              {analysis.scanCoverage?.warning && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-foreground">
                  Coverage note: {analysis.scanCoverage.warning}
                </span>
              )}
            </div>

            {analysis.summary && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {analysis.summary}
              </p>
            )}

            {analysis.narrative && (
              <div className="rounded-md border border-info/30 bg-info-soft p-3">
                <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-info-foreground uppercase">
                  <FileSearch className="size-3" />
                  Neutral technical reading
                  {analysis.narrativeModel && (
                    <span className="ml-1 normal-case text-muted-foreground">
                      · {analysis.narrativeProvider} {analysis.narrativeModel}
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">
                  {analysis.narrative}
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {(analysis.sections as SectionLike[]).map((section) => (
                <div key={section.key} className="surface-inset p-3">
                  <p className="text-xs font-semibold">{section.title}</p>
                  {section.noEvidence || section.evidence.length === 0 ? (
                    <p className="mt-1.5 text-xs italic leading-relaxed text-muted-foreground">
                      {NO_EVIDENCE_DETECTED}
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {section.evidence.map((item) => (
                        <li
                          key={`${item.label}::${item.source}`}
                          className="rounded-md bg-card px-2.5 py-1.5"
                        >
                          <p className="text-xs leading-relaxed">{item.label}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
                            <Github className="size-2.5 shrink-0" />
                            <span className="truncate font-mono">{item.source}</span>
                          </p>
                          {item.detail && (
                            <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground/80">
                              {item.detail}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            {analysis.verification.length > 0 && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs font-semibold">Potential verification</p>
                <ul className="mt-1.5 space-y-1">
                  {analysis.verification.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <CheckCircle2
                        aria-hidden
                        className="mt-px size-3.5 shrink-0 text-info"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
