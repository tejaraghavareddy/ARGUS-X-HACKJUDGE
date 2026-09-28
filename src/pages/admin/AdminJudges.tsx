import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Plus, ShieldAlert, UserCheck, UserX } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, initials } from "@/lib/rapture";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  name: string;
  email: string;
  password: string;
  title: string;
  organization: string;
  capacity: string;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  email: "",
  password: "",
  title: "",
  organization: "",
  capacity: "3",
};

export default function AdminJudges() {
  const data = useQuery(api.judges.listForAdmin);
  const createJudge = useMutation(api.judges.createJudge);
  const updateJudge = useMutation(api.judges.updateJudge);
  const setActive = useMutation(api.judges.setJudgeActive);
  const assign = useMutation(api.judges.assign);
  const unassign = useMutation(api.judges.unassign);
  const declareConflict = useMutation(api.judges.declareConflict);
  const resolveConflict = useMutation(api.judges.resolveConflict);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading judges…
        </div>
      </AppShell>
    );
  }

  const { judges, teams, conflicts } = data;
  const conflicted = new Set(conflicts.map((c) => `${c.judgeId}:${c.teamId}`));

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("A judge needs a name.");
      return;
    }
    setBusy(true);
    try {
      if (draft.id) {
        await updateJudge({
          judgeId: draft.id as never,
          name: draft.name,
          email: draft.email,
          title: draft.title || undefined,
          organization: draft.organization || undefined,
          capacity: Number(draft.capacity) || 0,
        });
        toast.success(`${draft.name} updated.`);
      } else {
        if (!draft.email.includes("@")) {
          toast.error("Enter a valid email address.");
          setBusy(false);
          return;
        }
        if (draft.password.length < 8) {
          toast.error("The password must be at least 8 characters.");
          setBusy(false);
          return;
        }
        await createJudge({
          name: draft.name,
          email: draft.email,
          password: draft.password,
          title: draft.title || undefined,
          organization: draft.organization || undefined,
          capacity: Number(draft.capacity) || 3,
        });
        toast.success(`${draft.name} added and can sign in now.`);
      }
      setDraft(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save judge.",
      );
    } finally {
      setBusy(false);
    }
  };

  /** Click an empty cell to assign, a filled cell to clear. */
  const toggleAssignment = async (
    judgeId: string,
    judgeName: string,
    teamId: string,
    teamName: string,
    currentlyAssigned: boolean,
  ) => {
    const key = `${judgeId}:${teamId}`;
    setPendingCell(key);
    try {
      if (currentlyAssigned) {
        await unassign({ judgeId: judgeId as never, teamId: teamId as never });
        toast.success(`${judgeName} unassigned from ${teamName}.`);
      } else {
        await assign({ judgeId: judgeId as never, teamId: teamId as never });
        toast.success(`${judgeName} assigned to ${teamName}.`);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not change assignment.",
      );
    } finally {
      setPendingCell(null);
    }
  };

  return (
    <AppShell role="admin">
      <PageHeader
        title="Judges"
        description="Who is judging, what they are carrying, and where conflicts of interest stand."
        actions={
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus />
            Add judge
          </Button>
        }
      />

      {draft && (
        <SectionCard
          className="mb-5"
          title={draft.id ? "Edit judge" : "Add judge"}
          description={
            draft.id
              ? "Changing the email also updates the sign-in account."
              : "Creates a sign-in account immediately with the password you set."
          }
          actions={
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="j-name">Name</Label>
              <Input
                id="j-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="j-email">Email</Label>
              <Input
                id="j-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </div>
            {!draft.id && (
              <div className="space-y-1.5">
                <Label htmlFor="j-password">Temporary password</Label>
                <Input
                  id="j-password"
                  value={draft.password}
                  placeholder="at least 8 characters"
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="j-title">Title</Label>
              <Input
                id="j-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="j-org">Organization</Label>
              <Input
                id="j-org"
                value={draft.organization}
                onChange={(e) =>
                  setDraft({ ...draft, organization: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="j-capacity">Review capacity</Label>
              <Input
                id="j-capacity"
                type="number"
                min={0}
                max={50}
                value={draft.capacity}
                onChange={(e) =>
                  setDraft({ ...draft, capacity: e.target.value })
                }
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={busy}
            onClick={() => void handleSave()}
          >
            {busy
              ? "Saving…"
              : draft.id
                ? "Save changes"
                : "Add judge and create login"}
          </Button>
        </SectionCard>
      )}

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="conflicts">
            Conflicts{conflicts.length > 0 ? ` (${conflicts.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roster">
          <SectionCard
            title="Judge roster"
            description="Deactivating a judge blocks new scorecards but keeps their history intact."
          >
            {judges.length === 0 ? (
              <EmptyState
                title="No judges yet"
                description="Add a judge to start building the panel."
              />
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="data-table min-w-[820px]">
                  <thead>
                    <tr>
                      <th>Judge</th>
                      <th>Status</th>
                      <th className="text-right">Assigned</th>
                      <th className="text-right">Completed</th>
                      <th className="text-right">In progress</th>
                      <th className="w-44">Load vs capacity</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {judges.map((judge) => (
                      <tr key={judge.id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-semibold">
                              {initials(judge.name)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium leading-tight">
                                {judge.name}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                {judge.email}
                                {judge.organization && ` · ${judge.organization}`}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge
                            tone={
                              judge.isActive
                                ? { label: "Active", className: "bg-success-soft text-success-foreground" }
                                : { label: "Inactive", className: "bg-muted text-muted-foreground" }
                            }
                          />
                        </td>
                        <td className="tabular text-right">{judge.assigned}</td>
                        <td className="tabular text-right font-medium">
                          {judge.completed}
                        </td>
                        <td className="tabular text-right">
                          {judge.inProgress}
                        </td>
                        <td>
                          <BlockProgress
                            done={judge.assigned}
                            total={Math.max(judge.capacity, judge.assigned)}
                            label="Capacity"
                          />
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDraft({
                                  id: judge.id,
                                  name: judge.name,
                                  email: judge.email,
                                  password: "",
                                  title: judge.title,
                                  organization: judge.organization,
                                  capacity: String(judge.capacity),
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                try {
                                  await setActive({
                                    judgeId: judge.id,
                                    isActive: !judge.isActive,
                                  });
                                  toast.success(
                                    `${judge.name} ${judge.isActive ? "deactivated" : "activated"}.`,
                                  );
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Could not change status.",
                                  );
                                }
                              }}
                            >
                              {judge.isActive ? (
                                <>
                                  <UserX />
                                  Deactivate
                                </>
                              ) : (
                                <>
                                  <UserCheck />
                                  Activate
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="assignments">
          <SectionCard
            title="Assignment matrix"
            description="Click a cell to assign or clear a pairing. Multiple judges per submission are supported."
          >
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="data-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Team</th>
                    {judges.map((judge) => (
                      <th key={judge.id} className="text-center">
                        <span className="block truncate">{judge.name}</span>
                        <span className="mt-0.5 block text-[0.625rem] font-normal text-muted-foreground">
                          {judge.isActive ? "active" : "inactive"}
                        </span>
                      </th>
                    ))}
                    <th className="text-right">Judges</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id}>
                      <td>
                        <p className="font-medium leading-tight">
                          {team.projectName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {team.name}
                        </p>
                      </td>
                      {judges.map((judge) => {
                        const isAssigned = judge.teamIds.includes(team.id);
                        const isConflicted = conflicted.has(
                          `${judge.id}:${team.id}`,
                        );
                        const busy = pendingCell === `${judge.id}:${team.id}`;
                        return (
                          <td key={judge.id} className="text-center">
                            <button
                              type="button"
                              disabled={busy || isConflicted}
                              aria-label={`${judge.name} on ${team.name}`}
                              title={
                                isConflicted
                                  ? "Conflict of interest declared"
                                  : isAssigned
                                    ? "Click to unassign"
                                    : "Click to assign"
                              }
                              onClick={() =>
                                void toggleAssignment(
                                  judge.id,
                                  judge.name,
                                  team.id,
                                  team.name,
                                  isAssigned,
                                )
                              }
                              className={cn(
                                "mx-auto flex size-8 items-center justify-center rounded-md border text-xs font-semibold transition-colors",
                                isConflicted
                                  ? "cursor-not-allowed border-destructive/30 bg-danger-soft text-destructive"
                                  : isAssigned
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input bg-card text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
                              )}
                            >
                              {isConflicted ? "×" : isAssigned ? "✓" : "–"}
                            </button>
                          </td>
                        );
                      })}
                      <td className="tabular text-right font-medium">
                        {team.assigned}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-destructive">×</span> marks a
              declared conflict — the judge is stood down and cannot open that
              submission. Declaring a conflict also removes any existing
              assignment for the pair.
            </p>
          </SectionCard>
        </TabsContent>

        <TabsContent value="conflicts">
          <SectionCard
            title="Conflicts of interest"
            description="A conflicted judge is blocked from reading and scoring that submission."
          >
            <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
              <p className="text-sm text-muted-foreground">
                Declare a conflict from the assignments tab by picking the
                pairing, then choosing to stand the judge down.
              </p>
            </div>

            {conflicts.length === 0 ? (
              <EmptyState
                title="No conflicts declared"
                description="No judge has been stood down from a submission."
              />
            ) : (
              <ul className="space-y-3">
                {conflicts.map((conflict) => (
                  <li
                    key={conflict.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-destructive/25 bg-danger-soft p-4"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium text-danger-foreground">
                        <ShieldAlert className="size-4" />
                        {conflict.judgeName}
                        <span className="font-normal text-muted-foreground">
                          cannot judge
                        </span>
                        {conflict.teamName}
                      </p>
                      {conflict.reason && (
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                          {conflict.reason}
                        </p>
                      )}
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Declared {formatDateTime(conflict.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await resolveConflict({
                            conflictId: conflict.id,
                          });
                          toast.success(
                            "Conflict resolved. The judge can be reassigned.",
                          );
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not resolve conflict.",
                          );
                        }
                      }}
                    >
                      Resolve
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {teams.length > 0 && judges.length > 0 && (
              <div className="mt-6 border-t border-border pt-4">
                <p className="mb-3 text-xs font-semibold text-muted-foreground">
                  Declare a new conflict
                </p>
                <div className="flex flex-wrap gap-2">
                  {judges.map((judge) =>
                    teams
                      .filter(
                        (team) =>
                          !conflicted.has(`${judge.id}:${team.id}`) &&
                          judge.teamIds.includes(team.id),
                      )
                      .slice(0, 6)
                      .map((team) => (
                        <Button
                          key={`${judge.id}:${team.id}`}
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            const reason =
                              window.prompt(
                                `Why can ${judge.name} not judge ${team.name}?`,
                              ) ?? undefined;
                            if (reason === null) return;
                            try {
                              await declareConflict({
                                judgeId: judge.id,
                                teamId: team.id,
                                reason: reason || undefined,
                              });
                              toast.success(
                                `${judge.name} stood down from ${team.name}.`,
                              );
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not declare conflict.",
                              );
                            }
                          }}
                        >
                          <ShieldAlert />
                          {judge.name.split(" ")[0]} ↔ {team.name.replace("Team ", "")}
                        </Button>
                      )),
                  )}
                </div>
                {conflicts.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Only judges currently assigned to a team are listed.
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
