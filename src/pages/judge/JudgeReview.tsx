import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileText,
  Lock,
  Paperclip,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import {
  Countdown,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { CopilotPanel } from "@/components/app/CopilotPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUBMISSION_TONE, formatDateTime, formatRelativeDue } from "@/lib/rapture";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/convex/lib/participant";

const RECOMMENDATIONS = [
  { value: "advance", label: "Advance to final" },
  { value: "hold", label: "Hold — borderline" },
  { value: "reject", label: "Do not advance" },
] as const;

type View = "score" | "confirm";

/** Human labels for the four upload categories, matching the participant form. */
const DOCUMENT_LABELS: Record<string, string> = {
  presentation: "Presentation",
  documentation: "Documentation",
  architecture: "Architecture diagram",
  supporting: "Supporting file",
};

export default function JudgeReview() {
  const { teamId } = useParams<{ teamId: string }>();
  // The route param is a string; Convex ids are branded, so narrow it once
  // here. An invalid id fails to resolve, and the server-side assignment check
  // independently guards the read.
  const team = teamId ? (teamId as Id<"teams">) : null;
  const data = useQuery(api.judging.reviewDetail, team ? { teamId: team } : "skip");
  const saveScore = useMutation(api.judging.saveScore);
  const copilotBrief = useQuery(
    api.copilot.briefForSubmission,
    team ? { teamId: team } : "skip",
  );

  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [criterionComments, setCriterionComments] = useState<Record<string, string>>({});
  const [comments, setComments] = useState("");
  const [recommendation, setRecommendation] = useState<
    "advance" | "hold" | "reject"
  >("hold");
  const [view, setView] = useState<View>("score");
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);

  // Seed the form from the judge's own saved draft. Nothing here ever reads
  // another judge's scorecard.
  const scoreKey = data ? JSON.stringify(data.myScore ?? null) : null;
  useEffect(() => {
    if (!data) return;
    setBreakdown(data.myScore?.breakdown ?? {});
    setCriterionComments(data.myScore?.criterionComments ?? {});
    setComments(data.myScore?.comments ?? "");
    setRecommendation(data.myScore?.recommendation ?? "hold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreKey]);

  if (data === undefined) {
    return (
      <AppShell role="judge">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading submission…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="judge">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">Submission not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This submission is not assigned to you, or is no longer available.
          </p>
          <Link to="/judge" className="btn-base btn-primary mt-5">
            Back to my queue
          </Link>
        </div>
      </AppShell>
    );
  }

  const isLocked = data.myScore?.isFinal ?? false;

  // The total is derived, never entered. A judge cannot type it; the server
  // recomputes it independently on every save.
  const total = data.criteria.reduce((sum, criterion) => {
    const value = breakdown[criterion.name];
    if (typeof value !== "number") return sum;
    return sum + Math.max(0, Math.min(criterion.maxScore, value));
  }, 0);
  const maxTotal = data.criteria.reduce(
    (sum, criterion) => sum + criterion.maxScore,
    0,
  );
  const scoredCount = data.criteria.filter(
    (c) => typeof breakdown[c.name] === "number",
  ).length;
  const allScored = scoredCount === data.criteria.length;

  const handleSaveDraft = async () => {
    if (!team) return;
    setSaving("draft");
    try {
      await saveScore({
        teamId: team,
        breakdown,
        criterionComments,
        comments,
        recommendation,
        isFinal: false,
      });
      toast.success("Draft saved. Only you can see it.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save your draft.",
      );
    } finally {
      setSaving(null);
    }
  };

  const handleFinalSubmit = async () => {
    if (!team) return;
    setSaving("final");
    try {
      const result = await saveScore({
        teamId: team,
        breakdown,
        criterionComments,
        comments,
        recommendation,
        isFinal: true,
      });
      toast.success(
        `Evaluation submitted and locked at ${result.totalScore} / ${result.maxTotalScore}.`,
      );
      setView("score");
      setAcknowledge(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit.",
      );
    } finally {
      setSaving(null);
    }
  };

  const goToConfirm = () => {
    if (!allScored) {
      toast.error("Score every criterion before submitting.");
      return;
    }
    if (!comments.trim()) {
      toast.error("Add an overall comment before submitting.");
      return;
    }
    setView("confirm");
    window.scrollTo({ top: 0 });
  };

  // --- Review and confirm: the last screen before the card is sealed. ------
  if (view === "confirm" && !isLocked) {
    return (
      <AppShell role="judge">
        <Link
          to="/judge"
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          My queue
        </Link>

        <PageHeader
          title="Review before submitting"
          description={`${data.team.projectName} — this is exactly what will be recorded against your name.`}
        />

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <div className="space-y-5">
            <SectionCard title="Your scores">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Criterion</th>
                    <th className="text-right">Score</th>
                    <th className="w-[46%]">Your comment</th>
                  </tr>
                </thead>
                <tbody>
                  {data.criteria.map((criterion) => (
                    <tr key={criterion.name}>
                      <td className="font-medium">{criterion.name}</td>
                      <td className="text-right tabular font-semibold">
                        {breakdown[criterion.name] ?? "–"}
                        <span className="text-xs font-normal text-muted-foreground">
                          /{criterion.maxScore}
                        </span>
                      </td>
                      <td className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                        {(criterionComments[criterion.name] ?? "").trim() ||
                          "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>

            <SectionCard title="Overall comment">
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {comments.trim() || "—"}
              </p>
            </SectionCard>

            <SectionCard title="Recommendation">
              <p className="text-sm font-medium">
                {RECOMMENDATIONS.find((r) => r.value === recommendation)?.label}
              </p>
            </SectionCard>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3.5">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-sm leading-relaxed text-foreground">
                I understand that submitting locks this evaluation permanently.
                I cannot edit it afterwards, and an administrator has to reopen
                it if something needs correcting.
              </span>
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setView("score")}
                disabled={saving !== null}
              >
                <ArrowLeft />
                Back to scoring
              </Button>
              <Button
                className="flex-1"
                disabled={!acknowledge || saving !== null}
                onClick={() => void handleFinalSubmit()}
              >
                <Send />
                {saving === "final" ? "Submitting…" : "Confirm and submit"}
              </Button>
            </div>
          </div>

          <div className="space-y-5">
            <SectionCard title="Final score">
              <p className="font-mono text-4xl font-semibold tracking-tight text-foreground">
                {total.toFixed(0)}
                <span className="text-lg font-medium text-muted-foreground">
                  /{maxTotal}
                </span>
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Calculated from your criterion scores. It is not an editable
                field and the server recomputes it independently.
              </p>
            </SectionCard>
            {data.deadline && <Countdown to={data.deadline} />}
          </div>
        </div>
      </AppShell>
    );
  }

  // Per-criterion AI evidence now comes from the copilot brief (judgingBriefs
  // table), not the static aiReview blob.
  const evidenceFor = (criterionName: string): string[] =>
    (copilotBrief?.criteria?.[criterionName]?.evidence ?? []).map(
      (c) => `${c.claim} — “${c.sourceQuote}”`,
    );

  return (
    <AppShell role="judge">
      <Link
        to="/judge"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        My queue
      </Link>

      <PageHeader
        title={data.team.projectName || "Unnamed project"}
        description={
          data.blindJudging
            ? data.team.name
            : `${data.team.name} — ${data.team.tagline}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.submission?.submissionRef && (
              <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-xs font-semibold">
                {data.submission.submissionRef}
              </span>
            )}
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

      {isLocked && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/40 bg-success-soft px-4 py-3.5">
          <Lock className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Evaluation submitted and locked
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Submitted {formatDateTime(data.myScore?.submittedAt)} for a total
              of <span className="font-semibold text-foreground">{data.myScore?.totalScore}</span> /{" "}
              {data.myScore?.maxTotalScore}. Submitted evaluations are
              immutable — only an administrator can reopen one.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr] lg:items-start">
        {/* Left: the submission, in the team's own words. */}
        <div className="space-y-5">
          <SectionCard
            title="The problem"
            description="What the team says is broken, and for whom."
          >
            <Prose text={data.submission?.problemStatement} />
          </SectionCard>

          <SectionCard title="The solution" description="What they built.">
            <Prose text={data.submission?.solutionDescription} />
          </SectionCard>

          <SectionCard
            title="Key features"
            description="The things the team most wants judged on."
          >
            {data.submission?.keyFeatures.length ? (
              <ul className="space-y-1.5">
                {data.submission.keyFeatures.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-relaxed">
                    <span aria-hidden className="font-medium text-primary">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not provided.</Empty>
            )}
          </SectionCard>

          <SectionCard title="Target users" description="Who this is for.">
            <Prose text={data.submission?.targetUsers} />
          </SectionCard>

          <SectionCard title="Technology stack">
            {data.team.techStack.length ? (
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
            ) : (
              <Empty>Not provided.</Empty>
            )}
            {data.submission?.implementationDetails && (
              <div className="mt-4 border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground">
                  Implementation
                </p>
                <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line">
                  {data.submission.implementationDetails}
                </p>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Uploaded documents"
            description="Evidence the team attached. Open anything you want to interrogate."
          >
            {data.documents.length === 0 ? (
              <Empty>No documents were attached to this submission.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.documents.map((doc) => (
                  <li key={doc.id}>
                    <a
                      href={doc.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {doc.name}
                          </span>
                          <span className="block text-[0.6875rem] text-muted-foreground">
                            {DOCUMENT_LABELS[doc.kind] ?? doc.kind}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {formatBytes(doc.size)}
                        <ExternalLink className="size-3" />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Links">
            <div className="flex flex-wrap gap-2">
              <ExternalLinkButton href={data.team.repoUrl} label="GitHub" />
              <ExternalLinkButton href={data.team.demoUrl} label="Live demo" />
              <ExternalLinkButton href={data.team.videoUrl} label="Demo video" />
            </div>
            {!data.team.repoUrl && !data.team.demoUrl && !data.team.videoUrl && (
              <Empty>No external links provided.</Empty>
            )}
          </SectionCard>

          {team && <CopilotPanel teamId={team} />}

          {!data.blindJudging && data.members.length > 0 && (
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
          )}
        </div>

        {/* Right: the scorecard. Human-owned end to end. */}
        <SectionCard
          title="Your evaluation"
          description={
            isLocked
              ? "Submitted and locked."
              : "Score every criterion. Drafts are private to you."
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
          {!isLocked && !allScored && (
            <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              {scoredCount} of {data.criteria.length} criteria scored. You can
              save a draft at any point and come back.
            </p>
          )}

          <div className="space-y-6">
            {data.criteria.map((criterion) => {
              const value = breakdown[criterion.name];
              const evidence = evidenceFor(criterion.name);
              return (
                <div key={criterion.name} className="border-b border-border pb-6 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold">{criterion.name}</span>
                    <span className="tabular text-sm font-semibold">
                      {typeof value === "number" ? value : "–"}
                      <span className="text-xs font-normal text-muted-foreground">
                        /{criterion.maxScore}
                      </span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {criterion.description}
                  </p>
                  {criterion.guidance && (
                    <p className="mt-1.5 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold">How to assess: </span>
                      {criterion.guidance}
                    </p>
                  )}

                  {evidence.length > 0 && (
                    <div className="mt-2.5 rounded-md border border-info/30 bg-info-soft px-2.5 py-2">
                      <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide text-info-foreground uppercase">
                        <Sparkles className="size-3" />
                        AI evidence — advisory only
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {evidence.map((line) => (
                          <li
                            key={line}
                            className="text-xs leading-relaxed text-foreground/80"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div
                    className="mt-2.5 flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={`${criterion.name} score out of ${criterion.maxScore}`}
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
                      ),
                    )}
                  </div>

                  <div className="mt-2.5 space-y-1.5">
                    <Label
                      htmlFor={`comment-${criterion.name}`}
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Your comment on {criterion.name}
                    </Label>
                    <Textarea
                      id={`comment-${criterion.name}`}
                      rows={2}
                      maxLength={2000}
                      disabled={isLocked}
                      value={criterionComments[criterion.name] ?? ""}
                      onChange={(e) =>
                        setCriterionComments((prev) => ({
                          ...prev,
                          [criterion.name]: e.target.value,
                        }))
                      }
                      placeholder="What in the submission led you to this score?"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between rounded-lg bg-secondary px-4 py-3">
            <span className="text-xs font-semibold text-secondary-foreground">
              Calculated total
            </span>
            <span className="tabular text-xl font-semibold text-foreground">
              {total.toFixed(0)}
              <span className="text-sm font-medium text-muted-foreground">
                /{maxTotal}
              </span>
            </span>
          </div>
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
            This total is calculated from your criterion scores. It cannot be
            typed or adjusted, and the server recomputes it on every save.
          </p>

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
            <Label
              htmlFor="comments"
              className="text-xs font-semibold text-muted-foreground"
            >
              Overall comment for the panel
            </Label>
            <Textarea
              id="comments"
              rows={5}
              maxLength={4000}
              disabled={isLocked}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="What convinced you, and what you could not verify. Required before you can submit."
            />
          </div>

          {!isLocked && (
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                disabled={saving !== null}
                onClick={() => void handleSaveDraft()}
              >
                <Save />
                {saving === "draft" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                className="flex-1"
                disabled={saving !== null}
                onClick={goToConfirm}
              >
                <Check />
                Review and submit
              </Button>
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Submitting locks this evaluation permanently. The AI evidence and
            briefing above are read-only context and have no effect on any number
            on this form.
          </p>
        </SectionCard>
      </div>
    </AppShell>
  );
}

function Prose({ text }: { text: string | undefined | null }) {
  if (!text || !text.trim()) return <Empty>Not provided.</Empty>;
  return (
    <p className="text-sm leading-relaxed whitespace-pre-line">{text}</p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function ExternalLinkButton({
  href,
  label,
}: {
  href: string | null | undefined;
  label: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="btn-base btn-outline btn-sm"
    >
      {href.includes("github") ? <FileText /> : <ExternalLink />}
      {label}
    </a>
  );
}
