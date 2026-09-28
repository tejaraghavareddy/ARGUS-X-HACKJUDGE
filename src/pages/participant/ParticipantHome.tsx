import { Link } from "react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Lock,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  Countdown,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import { Button } from "@/components/ui/button";
import { SUBMISSION_TONE, formatDate, formatDateTime } from "@/lib/rapture";

/**
 * The participant's home: where they stand and what is left to do.
 *
 * There is no team switcher and no score display anywhere on this screen. A
 * participant only ever sees their own team's record, and results stay hidden
 * until an admin publishes them.
 */
export default function ParticipantHome() {
  const data = useQuery(api.submissions.mySubmission);

  if (data === undefined) {
    return (
      <AppShell role="participant">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading your team…
        </div>
      </AppShell>
    );
  }

  if (data === null) {
    return (
      <AppShell role="participant">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">Session expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please sign in again to continue.
          </p>
        </div>
      </AppShell>
    );
  }

  const { team, submission, hackathon, completion, files, reviewProgress } =
    data;

  if (!team) {
    return (
      <AppShell role="participant">
        <PageHeader
          title="You are not on a team yet"
          description={
            hackathon
              ? `Create a team to start a submission for ${hackathon.name}.`
              : "There is no active hackathon right now."
          }
        />
        <SectionCard title="Get started">
          <p className="text-sm leading-relaxed text-muted-foreground">
            A team is the unit of submission. Create one, name it, then invite
            the people you are building with. Everyone on the team shares the
            same submission.
          </p>
          <div className="mt-5">
            <Button asChild>
              <Link to="/participant/team">
                Create or join a team <ArrowRight />
              </Link>
            </Button>
          </div>
        </SectionCard>
      </AppShell>
    );
  }

  const locked = submission ? submission.status !== "draft" : false;
  const reopened = Boolean(submission?.reopenedAt);

  return (
    <AppShell role="participant">
      <PageHeader
        title={team.projectName || "Name your project"}
        description={`${team.name}${team.tagline ? ` — ${team.tagline}` : ""}`}
        actions={
          submission ? (
            <StatusBadge
              tone={SUBMISSION_TONE[submission.status] ?? SUBMISSION_TONE.draft}
            />
          ) : (
            <StatusBadge tone={SUBMISSION_TONE.draft} />
          )
        }
      />

      {reopened && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              An administrator reopened your submission
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {submission?.reopenNote} — reopened{" "}
              {formatDate(submission?.reopenedAt)}. Make your changes and submit
              again before the deadline.
            </p>
          </div>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Submission"
          value={submission ? formatDate(submission.submittedAt) : "Not started"}
          hint={submission?.submissionRef ?? undefined}
          tone={locked ? "accent" : "primary"}
        />
        <StatTile
          label="Team"
          value={`${team.members.length} ${team.members.length === 1 ? "member" : "members"}`}
          hint={hackathon ? `Max ${hackathon.maxTeamSize}` : undefined}
        />
        <StatTile
          label="Files"
          value={files.length}
          hint={files.length === 0 ? "None uploaded" : "Attached"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-start">
        <div className="space-y-5">
          <SectionCard
            title="Deadline"
            description={
              hackathon
                ? `Submissions close ${formatDateTime(hackathon.submissionsCloseAt)}`
                : undefined
            }
          >
            {hackathon ? (
              <>
                <Countdown to={hackathon.submissionsCloseAt} />
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  {hackathon.submissionsOpen
                    ? "Submissions are open. Save as often as you like — nothing is final until you confirm."
                    : "The organizers have paused new submissions. You can still save a draft, but you will not be able to finalize until submissions reopen."}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No active hackathon.</p>
            )}
          </SectionCard>

          <SectionCard
            title="Your submission"
            description={
              locked
                ? "Finalized and locked. An administrator can reopen it if something needs fixing."
                : "Work through the form, save as you go, then confirm and submit."
            }
          >
            <BlockProgress
              done={completion}
              total={100}
              label="Submission complete"
              hideCount
            />

            <ul className="mt-5 space-y-2.5 text-sm">
              <li className="flex items-center gap-2.5">
                {completion >= 100 ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-foreground">Written sections</span>
                <span className="ml-auto text-muted-foreground">
                  10 required answers
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                {files.some((f) => f.kind === "presentation") ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-foreground">Presentation</span>
                <span className="ml-auto text-muted-foreground">PDF or PPT</span>
              </li>
              <li className="flex items-center gap-2.5">
                {files.some((f) => f.kind === "documentation") ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-foreground">Documentation</span>
                <span className="ml-auto text-muted-foreground">PDF or Markdown</span>
              </li>
            </ul>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link to="/participant/submission">
                  {locked ? "View submission" : "Continue submission"}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link to="/participant/team">
                  <Users />
                  Manage team
                </Link>
              </Button>
            </div>
          </SectionCard>

          {locked && submission?.submissionRef && (
            <SectionCard title="Submission receipt">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Submission ID
                  </dt>
                  <dd className="mt-1 font-mono text-sm font-semibold">
                    {submission.submissionRef}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Submitted at
                  </dt>
                  <dd className="mt-1 text-sm">
                    {formatDateTime(submission.submittedAt)}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                Quote this ID in any correspondence with the organizers. It is
                fixed for the life of the submission.
              </p>
            </SectionCard>
          )}
        </div>

        <div className="space-y-5">
          <SectionCard title="Your team">
            <ul className="divide-y divide-border">
              {team.members.map((member) => (
                <li
                  key={member.email}
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
                    {member.isLead ? "Team lead" : member.role}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-border pt-4">
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/participant/team">
                  <Users />
                  {team.isLead ? "Manage members" : "View members"}
                </Link>
              </Button>
            </div>
          </SectionCard>

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

          <SectionCard title="What happens next">
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex gap-2.5">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>You submit before the deadline and your work locks.</span>
              </li>
              <li className="flex gap-2.5">
                <Users className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Assigned judges review your submission anonymously.</span>
              </li>
              <li className="flex gap-2.5">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                  Scores and rankings stay private until organizers publish the
                  results.
                </span>
              </li>
            </ol>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
