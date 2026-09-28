import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ExternalLink, Send } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SUBMISSION_TONE, formatDate } from "@/lib/rapture";

/**
 * The participant's entire world: their team and their submission.
 *
 * There is no team switcher and no score display. A participant can only ever
 * see their own team's record, and results stay hidden until an admin
 * publishes them.
 */
export default function ParticipantHome() {
  const data = useQuery(api.teams.myTeam);
  const updateSubmission = useMutation(api.submissions.updateSubmission);
  const submitSubmission = useMutation(api.submissions.submitSubmission);

  const [abstract, setAbstract] = useState("");
  const [highlights, setHighlights] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data?.submission) return;
    setAbstract(data.submission.abstract);
    setHighlights(data.submission.highlights.join("\n"));
    setVideoUrl(data.submission.videoUrl ?? "");
  }, [data]);

  if (data === undefined) {
    return (
      <AppShell role="participant">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading your team…
        </div>
      </AppShell>
    );
  }

  if (!data.team) {
    return (
      <AppShell role="participant">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">No team yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You are not on a team for this hackathon. Ask your team lead to add
            you.
          </p>
        </div>
      </AppShell>
    );
  }

  const { team, submission, reviewProgress } = data;
  const locked = submission?.status !== "draft";

  const handleSave = async () => {
    if (!submission) return;
    setSaving(true);
    try {
      await updateSubmission({
        abstract,
        highlights: highlights
          .split("\n")
          .map((h) => h.trim())
          .filter(Boolean),
        videoUrl,
      });
      toast.success("Submission saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save submission.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await submitSubmission({});
      toast.success("Submission locked in. Good luck.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell role="participant">
      <PageHeader
        title={team.projectName}
        description={`${team.name} — ${team.tagline}`}
        actions={
          submission ? (
            <StatusBadge
              tone={SUBMISSION_TONE[submission.status] ?? SUBMISSION_TONE.draft}
            />
          ) : null
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile label="Track" value={team.trackName} tone="primary" />
        <StatTile label="Team members" value={team.members.length} />
        <StatTile
          label="Your role"
          value={data.membership?.isLead ? "Lead" : "Member"}
          hint={data.membership?.role}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <div className="space-y-5">
          <SectionCard
            title="Your submission"
            description={
              locked
                ? `Submitted ${formatDate(submission?.submittedAt)} and locked. Contact an admin if you need a change.`
                : "Edit anything below, then submit when you are ready."
            }
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="abstract">Project summary</Label>
                <Textarea
                  id="abstract"
                  rows={7}
                  value={abstract}
                  disabled={locked}
                  onChange={(e) => setAbstract(e.target.value)}
                  placeholder="What does it do, who is it for, and how did you build it?"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="highlights">Highlights</Label>
                <Textarea
                  id="highlights"
                  rows={4}
                  value={highlights}
                  disabled={locked}
                  onChange={(e) => setHighlights(e.target.value)}
                  placeholder="One per line — the three things you most want judges to notice."
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="video">Demo video URL</Label>
                <Input
                  id="video"
                  value={videoUrl}
                  disabled={locked}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>

            {!locked && (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button
                  className="flex-1"
                  disabled={saving}
                  onClick={() => void handleSubmit()}
                >
                  <Send />
                  Submit — locks edits
                </Button>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Your team">
            <ul className="divide-y divide-border">
              {team.members.map((member) => (
                <li
                  key={member.name}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-sm font-medium">
                    {member.name}
                    {member.isYou && (
                      <span className="ml-2 rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-semibold text-accent-foreground">
                        You
                      </span>
                    )}
                  </span>
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

            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              {team.demoUrl && (
                <a
                  href={team.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Live demo <ExternalLink />
                </a>
              )}
              {team.repoUrl && (
                <a
                  href={team.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-base btn-outline btn-sm"
                >
                  Repository <ExternalLink />
                </a>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard
            title="Review progress"
            description="How far your judging round has got."
          >
            <BlockProgress
              done={reviewProgress.completed}
              total={reviewProgress.assignedJudges}
              label="Judges finished"
            />
            <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Individual scores and rankings stay private until results are
              published. You will see the outcome here once organizers release
              them.
            </p>
          </SectionCard>

          <AdvisoryPanel review={submission?.aiReview} audience="participant" />
        </div>
      </div>
    </AppShell>
  );
}
