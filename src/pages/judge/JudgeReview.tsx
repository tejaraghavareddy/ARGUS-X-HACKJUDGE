import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard, StatusBadge } from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SUBMISSION_TONE, formatDate, formatRelativeDue } from "@/lib/rapture";
import { cn } from "@/lib/utils";

const RECOMMENDATIONS = [
  { value: "advance", label: "Advance to final" },
  { value: "hold", label: "Hold — borderline" },
  { value: "reject", label: "Do not advance" },
] as const;

export default function JudgeReview() {
  const { teamId } = useParams<{ teamId: string }>();
  // The route param is a string; Convex ids are branded, so narrow it once
  // here. An invalid id fails to resolve, and the server-side assignment check
  // independently guards the read.
  const team = teamId ? (teamId as Id<"teams">) : null;
  const data = useQuery(api.judging.reviewDetail, team ? { teamId: team } : "skip");
  const saveScore = useMutation(api.judging.saveScore);

  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const [recommendation, setRecommendation] = useState<
    "advance" | "hold" | "reject"
  >("hold");
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);

  // Seed the form from the judge's own saved draft. Nothing here ever reads
  // another judge's scorecard.
  useEffect(() => {
    if (!data) return;
    setBreakdown(data.myScore?.breakdown ?? {});
    setComments(data.myScore?.comments ?? "");
    setRecommendation(data.myScore?.recommendation ?? "hold");
  }, [data]);

  if (data === undefined) {
    return (
      <AppShell role="judge">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading team…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="judge">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">Team not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This team is no longer available to you.
          </p>
          <Link to="/judge" className="btn-base btn-primary mt-5">
            Back to my teams
          </Link>
        </div>
      </AppShell>
    );
  }

  const isLocked = data.myScore?.isFinal ?? false;

  const total = data.criteria.reduce((sum, criterion) => {
    const value = breakdown[criterion.name];
    if (typeof value !== "number") return sum;
    return sum + Math.max(0, Math.min(criterion.maxScore, value));
  }, 0);
  const maxTotal = data.criteria.reduce(
    (sum, criterion) => sum + criterion.maxScore,
    0,
  );

  const allScored = data.criteria.every(
    (c) => typeof breakdown[c.name] === "number",
  );

  const handleSave = async (isFinal: boolean) => {
    if (!team) return;
    if (isFinal && !allScored) {
      toast.error("Score every criterion before submitting.");
      return;
    }
    setSaving(isFinal ? "final" : "draft");
    try {
      const result = await saveScore({
        teamId: team,
        breakdown,
        comments,
        recommendation,
        isFinal,
      });
      toast.success(
        isFinal
          ? `Scorecard submitted and locked at ${result.totalScore}.`
          : "Draft saved. Only you can see it.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save scorecard.",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell role="judge">
      <Link
        to="/judge"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All my teams
      </Link>

      <PageHeader
        title={data.team.projectName}
        description={`${data.team.name} — ${data.team.tagline}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.submission && (
              <StatusBadge
                tone={
                  SUBMISSION_TONE[data.submission.status] ??
                  SUBMISSION_TONE.draft
                }
              />
            )}
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
              {formatRelativeDue(data.assignment.dueAt)}
            </span>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        {/* Left: everything needed to form a view. */}
        <div className="space-y-5">
          <SectionCard title="Submission">
            <div className="flex flex-wrap gap-1.5">
              {data.team.techStack.map((tech) => (
                <span
                  key={tech}
                  className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                >
                  {tech}
                </span>
              ))}
            </div>

            <p className="mt-4 text-sm leading-relaxed">
              {data.submission?.abstract}
            </p>

            {data.submission?.highlights.length ? (
              <div className="mt-5">
                <p className="text-xs font-semibold text-muted-foreground">
                  Team highlights
                </p>
                <ul className="mt-2 space-y-1.5">
                  {data.submission.highlights.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 text-sm leading-relaxed"
                    >
                      <span
                        aria-hidden
                        className="font-medium text-primary"
                      >
                        →
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {data.team.demoUrl && (
                <a
                  href={data.team.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Live demo <ExternalLink />
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
              {data.submission?.videoUrl && (
                <a
                  href={data.submission.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Demo video <ExternalLink />
                </a>
              )}
            </div>
          </SectionCard>

          <AdvisoryPanel review={data.submission?.aiReview} audience="judge" />

          <SectionCard title="Team members">
            <ul className="divide-y divide-border">
              {data.members.map((member) => (
                <li
                  key={member.name}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium">{member.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {member.isLead && (
                      <span className="mr-1.5 font-medium text-foreground">
                        Lead
                      </span>
                    )}
                    {member.role}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>

        {/* Right: the scorecard. Human-owned end to end. */}
        <SectionCard
          title="Your scorecard"
          description={
            isLocked
              ? "Submitted and locked."
              : "Weighted against the shared rubric. Drafts are private to you."
          }
          actions={
            isLocked ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-success-foreground">
                <Lock className="size-3" />
                Locked
              </span>
            ) : null
          }
        >
          {isLocked && (
            <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              You submitted this scorecard {formatDate(data.myScore?.submittedAt)}.
              Submitted scorecards are immutable — ask an admin if something
              needs correcting.
            </p>
          )}

          <div className="space-y-5">
            {data.criteria.map((criterion) => {
              const value = breakdown[criterion.name];
              return (
                <div key={criterion.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{criterion.name}</span>
                    <span className="tabular text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {typeof value === "number" ? value : "–"}/
                        {criterion.maxScore}
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {criterion.description}
                  </p>
                  {criterion.guidance && (
                    <p className="mt-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                      {criterion.guidance}
                    </p>
                  )}
                  <div
                    className="mt-2 flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={`${criterion.name} score`}
                  >
                    {Array.from({ length: criterion.maxScore }, (_, i) => i + 1).map(
                      (point) => (
                      <button
                        key={point}
                        type="button"
                        disabled={isLocked}
                        aria-label={`${criterion.name}: ${point} of ${criterion.maxScore}`}
                        aria-pressed={value === point}
                        onClick={() =>
                          setBreakdown((prev) => ({
                            ...prev,
                            [criterion.name]: point,
                          }))
                        }
                        className={cn(
                          "tabular size-8 rounded-md border text-sm font-medium transition-colors disabled:cursor-not-allowed",
                          value === point
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-card hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
                        )}
                      >
                        {point}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between rounded-lg bg-secondary px-4 py-3">
            <span className="text-xs font-semibold text-secondary-foreground">
              Weighted total
            </span>
            <span className="tabular text-xl font-semibold text-foreground">
              {total.toFixed(1)}
              <span className="text-sm font-medium text-muted-foreground">
                /{maxTotal}
              </span>
            </span>
          </div>

          <fieldset className="mt-5">
            <legend className="text-xs font-semibold text-muted-foreground">
              Recommendation
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {RECOMMENDATIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isLocked}
                  onClick={() => setRecommendation(option.value)}
                  aria-pressed={recommendation === option.value}
                  className={cn(
                    "rounded-md border px-2.5 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                    recommendation === option.value
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-input bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 space-y-1.5">
            <label
              htmlFor="comments"
              className="text-xs font-semibold text-muted-foreground"
            >
              Comments for the panel
            </label>
            <Textarea
              id="comments"
              rows={5}
              value={comments}
              disabled={isLocked}
              onChange={(e) => setComments(e.target.value)}
              placeholder="What convinced you, and what you could not verify."
            />
          </div>

          {!isLocked && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                disabled={saving !== null}
                onClick={() => void handleSave(false)}
              >
                {saving === "draft" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                className="flex-1"
                disabled={saving !== null}
                onClick={() => void handleSave(true)}
              >
                {saving === "final" ? "Submitting…" : "Submit scorecard"}
              </Button>
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Submitting locks this scorecard permanently. The AI briefing above is
            read-only context and has no effect on any number on this form.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
