import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import {
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  SUBMISSION_TONE,
  formatDate,
  formatRelativeDue,
} from "@/lib/rapture";
import { cn } from "@/lib/utils";

const RECOMMENDATIONS = [
  { value: "advance", label: "Advance to final" },
  { value: "hold", label: "Hold — borderline" },
  { value: "reject", label: "Do not advance" },
] as const;

export default function JudgeReview() {
  const { teamId } = useParams<{ teamId: string }>();
  // The route param is a string; Convex ids are branded, so narrow it once
  // here. An invalid id simply fails to resolve and the query returns an
  // error, which the server-side assignment check also guards.
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
        <div className="nb-inset px-6 py-10 text-center text-sm font-semibold uppercase tracking-widest">
          Loading team…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="judge">
        <div className="nb-card p-8">
          <h1 className="text-xl font-black">Team not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This team is no longer available to you.
          </p>
          <Link
            to="/judge"
            className="nb-press mt-5 inline-flex h-10 items-center border-2 border-ink bg-primary px-4 text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          >
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
    return sum + (value / criterion.maxScore) * criterion.weight;
  }, 0);

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
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest hover:underline"
      >
        <ArrowLeft className="size-3.5" />
        All my teams
      </Link>

      <PageHeader
        title={data.team.projectName}
        description={`${data.team.name} · ${data.team.tagline}`}
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
            <span className="border-2 border-ink bg-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider">
              {formatRelativeDue(data.assignment.dueAt)}
            </span>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr] lg:items-start">
        {/* Left: everything the judge needs to form a view. */}
        <div className="space-y-5">
          <SectionCard title="Submission">
            <div className="flex flex-wrap gap-2">
              {data.team.techStack.map((tech) => (
                <span
                  key={tech}
                  className="border-2 border-ink bg-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider"
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
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Team highlights
                </p>
                <ul className="mt-2 space-y-1.5">
                  {data.submission.highlights.map((item) => (
                    <li key={item} className="flex gap-2 text-sm">
                      <span aria-hidden className="font-black">
                        →
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-2 border-t-2 border-ink pt-4">
              {data.team.demoUrl && (
                <a
                  href={data.team.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nb-press inline-flex h-9 items-center gap-2 border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
                >
                  Live demo <ExternalLink className="size-3.5" />
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
              {data.submission?.videoUrl && (
                <a
                  href={data.submission.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nb-press inline-flex h-9 items-center gap-2 border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
                >
                  Demo video <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </SectionCard>

          <AdvisoryPanel review={data.submission?.aiReview} audience="judge" />

          <SectionCard title="Team members">
            <ul className="space-y-2">
              {data.members.map((member) => (
                <li
                  key={member.name}
                  className="flex items-center justify-between border-2 border-ink bg-surface px-3 py-2"
                >
                  <span className="text-sm font-semibold">{member.name}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {member.isLead ? "Lead · " : ""}
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
              <span className="flex items-center gap-1.5 border-2 border-ink bg-[#1f9d55] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                <Lock className="size-3" /> Locked
              </span>
            ) : null
          }
        >
          {isLocked && (
            <p className="mb-4 border-2 border-ink bg-[#e6e6de] px-3 py-2 text-xs leading-snug">
              You submitted this scorecard{" "}
              {formatDate(data.myScore?.submittedAt)}. Submitted scorecards are
              immutable — ask an admin if something needs correcting.
            </p>
          )}

          <div className="space-y-5">
            {data.criteria.map((criterion) => {
              const value = breakdown[criterion.name];
              return (
                <div key={criterion.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor={`criterion-${criterion.name}`}
                      className="text-sm font-bold"
                    >
                      {criterion.name}
                    </label>
                    <span className="tabular text-xs font-bold text-muted-foreground">
                      {criterion.weight}% · {typeof value === "number" ? value : "–"}
                      /{criterion.maxScore}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {criterion.description}
                  </p>
                  <div
                    id={`criterion-${criterion.name}`}
                    className="mt-2 flex gap-1.5"
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
                            "tabular h-9 w-9 border-2 border-ink text-sm font-bold transition-none disabled:cursor-not-allowed",
                            value === point
                              ? "bg-ink text-white"
                              : "bg-surface hover:bg-accent",
                          )}
                        >
                          {point}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between border-2 border-ink bg-ink px-4 py-3 text-white">
            <span className="text-[11px] font-bold uppercase tracking-widest">
              Weighted total
            </span>
            <span className="tabular text-2xl font-black">
              {total.toFixed(1)}
              <span className="text-sm font-bold opacity-60">/100</span>
            </span>
          </div>

          <div className="mt-5">
            <label
              htmlFor="recommendation"
              className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
            >
              Recommendation
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {RECOMMENDATIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isLocked}
                  onClick={() => setRecommendation(option.value)}
                  aria-pressed={recommendation === option.value}
                  className={cn(
                    "border-2 border-ink px-2 py-2 text-[11px] font-bold uppercase tracking-wider disabled:cursor-not-allowed",
                    recommendation === option.value
                      ? "bg-[#ffe500] text-ink"
                      : "bg-surface hover:bg-accent",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-1.5">
            <label
              htmlFor="comments"
              className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
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
              className="rounded-none border-2 border-ink bg-surface"
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
                <Save />
                Save draft
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

          <p className="mt-4 text-[11px] leading-snug text-muted-foreground">
            Submitting locks this scorecard permanently. The AI briefing above is
            read-only context and has no effect on any number on this form.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}
