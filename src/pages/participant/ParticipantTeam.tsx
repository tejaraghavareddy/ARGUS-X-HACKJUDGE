import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowRight, Crown, Lock, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUBMISSION_TONE } from "@/lib/rapture";

/**
 * Team setup and membership.
 *
 * The team is resolved server-side from the signed-in participant, so this page
 * has no team switcher and no id in the URL. Structural changes are lead-only
 * and that is enforced in the mutation, not just by hiding the buttons here.
 */
export default function ParticipantTeam() {
  const data = useQuery(api.submissions.mySubmission);
  const createTeam = useMutation(api.teams.createTeam);
  const updateTeam = useMutation(api.teams.updateTeam);
  const addMember = useMutation(api.teams.addMember);
  const removeMember = useMutation(api.teams.removeMember);
  const setLeader = useMutation(api.teams.setLeader);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      after?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (data === undefined) {
    return (
      <AppShell role="participant">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading your team…
        </div>
      </AppShell>
    );
  }

  // --- No team yet: the only thing to do is create one. -------------------
  if (!data.team) {
    return (
      <AppShell role="participant">
        <PageHeader
          title="Create your team"
          description={
            data.hackathon
              ? `${data.hackathon.name} — up to ${data.hackathon.maxTeamSize} people per team.`
              : "There is no active hackathon right now."
          }
        />
        <SectionCard title="Team details">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => createTeam({ name, tagline }), "Team created.", () => {
                setName("");
                setTagline("");
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Nightshift"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-tagline">One-line tagline (optional)</Label>
              <Input
                id="team-tagline"
                maxLength={90}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="What are you building, in one line?"
              />
            </div>
            <Button type="submit" disabled={busy || name.trim().length < 2}>
              {busy ? "Creating…" : "Create team"}
            </Button>
          </form>
          <p className="mt-5 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            You become the team lead and can invite the rest. If you already
            have a team, ask its lead to add you by email — then this screen
            fills in automatically.
          </p>
        </SectionCard>
      </AppShell>
    );
  }

  const { team, hackathon } = data;
  const isLead = team.isLead;
  const atCapacity = team.members.length >= (hackathon?.maxTeamSize ?? 6);

  return (
    <AppShell role="participant">
      <PageHeader
        title={team.name}
        description={team.tagline || "Add a tagline so judges know what you are building."}
        actions={
          <StatusBadge
            tone={isLead ? SUBMISSION_TONE.submitted : SUBMISSION_TONE.draft}
          />
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Members"
          value={`${team.members.length} / ${hackathon?.maxTeamSize ?? 6}`}
          hint={atCapacity ? "Team is full" : "Seats available"}
        />
        <StatTile label="Your role" value={isLead ? "Team lead" : "Member"} />
        <StatTile
          label="Project"
          value={team.projectName || "Not named yet"}
          hint="Set in the submission form"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div className="space-y-5">
          <SectionCard
            title="Members"
            description={
              isLead
                ? "You can add people, remove them, and hand over leadership."
                : "Only the team lead can change the roster."
            }
          >
            <ul className="divide-y divide-border">
              {team.members.map((member) => (
                <li
                  key={member.email || member.name}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {member.name}
                      {member.isYou && (
                        <span className="rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-semibold text-accent-foreground">
                          You
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {member.email || member.role}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {member.isLead ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[0.6875rem] font-semibold text-primary">
                        <Crown className="size-3" />
                        Lead
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {member.role}
                      </span>
                    )}
                    {isLead && !member.isLead && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => setLeader({ memberId: member.id! }),
                              `${member.name} is now the team lead.`,
                            )
                          }
                        >
                          <Crown />
                          Make lead
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => removeMember({ memberId: member.id! }),
                              `${member.name} removed.`,
                            )
                          }
                        >
                          <Trash2 />
                          <span className="sr-only">Remove {member.name}</span>
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          {isLead && (
            <SectionCard title="Add a teammate">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(
                    () =>
                      addMember({
                        name: memberName,
                        email: memberEmail,
                        role: memberRole,
                      }),
                    "Teammate added.",
                    () => {
                      setMemberName("");
                      setMemberEmail("");
                      setMemberRole("");
                    },
                  );
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="member-name">Full name</Label>
                    <Input
                      id="member-name"
                      required
                      minLength={2}
                      maxLength={60}
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                      placeholder="e.g. Priya Raman"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="member-email">Email</Label>
                    <Input
                      id="member-email"
                      type="email"
                      required
                      value={memberEmail}
                      onChange={(e) => setMemberEmail(e.target.value)}
                      placeholder="name@example.com"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="member-role">Role (optional)</Label>
                  <Input
                    id="member-role"
                    maxLength={40}
                    value={memberRole}
                    onChange={(e) => setMemberRole(e.target.value)}
                    placeholder="e.g. Backend, Design, Hardware"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busy || atCapacity}
                >
                  <UserPlus />
                  {atCapacity ? "Team is full" : "Add teammate"}
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Adding someone by email links them to this team the first
                  time they sign in. A person can only belong to one team.
                </p>
              </form>
            </SectionCard>
          )}
        </div>

        <div className="space-y-5">
          <SectionCard title="Team details">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => updateTeam({ name, tagline }),
                  "Team updated.",
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Team name</Label>
                <Input
                  id="edit-name"
                  required
                  minLength={2}
                  maxLength={60}
                  defaultValue={team.name}
                  disabled={!isLead}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setName(team.name)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-tagline">Tagline</Label>
                <Input
                  id="edit-tagline"
                  maxLength={90}
                  defaultValue={team.tagline}
                  disabled={!isLead}
                  onChange={(e) => setTagline(e.target.value)}
                  onFocus={() => setTagline(team.tagline)}
                />
              </div>
              {isLead && (
                <Button type="submit" disabled={busy}>
                  Save changes
                </Button>
              )}
            </form>
            {!isLead && (
              <p className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                Only the team lead can rename the team or change the roster.
              </p>
            )}
          </SectionCard>

          <SectionCard title="Next step">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {team.projectName
                ? "Your project is named. Keep the submission itself up to date as you build."
                : "Now fill in the submission form — the project name lives there."}
            </p>
            <div className="mt-4">
              <Button asChild className="w-full">
                <Link to="/participant/submission">
                  <Users className="hidden" />
                  Go to submission <ArrowRight />
                </Link>
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
