import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Check, Power } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  HACKATHON_TONE,
  formatDate,
  formatDateTime,
  fromDateTimeLocal,
  toDateTimeLocal,
} from "@/lib/rapture";
import { cn } from "@/lib/utils";

type DetailsForm = {
  name: string;
  logo: string;
  tagline: string;
  description: string;
  problemStatement: string;
  eligibility: string;
  rules: string;
  location: string;
  maxTeamSize: string;
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  submissionsCloseAt: string;
  judgingStartsAt: string;
  judgingEndsAt: string;
};

const EMPTY: DetailsForm = {
  name: "",
  logo: "",
  tagline: "",
  description: "",
  problemStatement: "",
  eligibility: "",
  rules: "",
  location: "",
  maxTeamSize: "4",
  startsAt: "",
  endsAt: "",
  registrationClosesAt: "",
  submissionsCloseAt: "",
  judgingStartsAt: "",
  judgingEndsAt: "",
};

type FlagKey =
  | "registrationOpen"
  | "submissionsOpen"
  | "judgingOpen"
  | "blindJudging"
  | "publicLeaderboard"
  | "resultsPublished";

const FLAGS: {
  key: FlagKey;
  label: string;
  help: string;
  confirm?: string;
}[] = [
  {
    key: "registrationOpen",
    label: "Registration",
    help: "Teams can register. Closing this hides the sign-up path for participants.",
  },
  {
    key: "submissionsOpen",
    label: "Submissions",
    help: "Participants can edit and submit. Closing locks every draft in place.",
  },
  {
    key: "judgingOpen",
    label: "Judging",
    help: "Judges can finalize scorecards. Judges can still save drafts while this is off.",
  },
  {
    key: "blindJudging",
    label: "Blind judging",
    help: "Hides team and member identity from judges, replacing it with an anonymous submission label.",
  },
  {
    key: "publicLeaderboard",
    label: "Public leaderboard",
    help: "Shows a public standings page built from finalized scorecards.",
  },
  {
    key: "resultsPublished",
    label: "Results published",
    help: "Releases the outcome to participants. Publishing never modifies a judge's scorecard.",
    confirm: "Publish results?",
  },
];

export default function AdminHackathon() {
  const active = useQuery(api.hackathons.activeHackathon);
  const all = useQuery(api.hackathons.listForAdmin);
  const update = useMutation(api.hackathons.update);
  const setFlag = useMutation(api.hackathons.setFlag);
  const create = useMutation(api.hackathons.create);
  const setCurrent = useMutation(api.hackathons.setCurrent);

  const [form, setForm] = useState<DetailsForm>(EMPTY);
  const [savingDetails, setSavingDetails] = useState(false);
  const [busyFlag, setBusyFlag] = useState<FlagKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!active) return;
    setForm({
      name: active.name,
      logo: active.logo ?? "",
      tagline: active.tagline,
      description: active.description,
      problemStatement: active.problemStatement ?? "",
      eligibility: active.eligibility ?? "",
      rules: active.rules ?? "",
      location: active.location,
      maxTeamSize: String(active.maxTeamSize),
      startsAt: toDateTimeLocal(active.startsAt),
      endsAt: toDateTimeLocal(active.endsAt),
      registrationClosesAt: toDateTimeLocal(active.registrationClosesAt),
      submissionsCloseAt: toDateTimeLocal(active.submissionsCloseAt),
      judgingStartsAt: toDateTimeLocal(active.judgingStartsAt),
      judgingEndsAt: toDateTimeLocal(active.judgingEndsAt),
    });
  }, [active]);

  if (active === undefined || all === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading hackathon…
        </div>
      </AppShell>
    );
  }

  if (!active) {
    return (
      <AppShell role="admin">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">No hackathon yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create one to get started.
          </p>
        </div>
      </AppShell>
    );
  }

  const set = (key: keyof DetailsForm) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSaveDetails = async () => {
    setSavingDetails(true);
    try {
      await update({
        hackathonId: active._id,
        name: form.name,
        logo: form.logo || undefined,
        tagline: form.tagline,
        description: form.description,
        problemStatement: form.problemStatement || undefined,
        eligibility: form.eligibility || undefined,
        rules: form.rules || undefined,
        location: form.location,
        maxTeamSize: Math.max(1, Number(form.maxTeamSize) || 1),
        startsAt: fromDateTimeLocal(form.startsAt),
        endsAt: fromDateTimeLocal(form.endsAt),
        registrationClosesAt: fromDateTimeLocal(form.registrationClosesAt),
        submissionsCloseAt: fromDateTimeLocal(form.submissionsCloseAt),
        judgingStartsAt: fromDateTimeLocal(form.judgingStartsAt),
        judgingEndsAt: fromDateTimeLocal(form.judgingEndsAt),
      });
      toast.success("Hackathon details saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save details.",
      );
    } finally {
      setSavingDetails(false);
    }
  };

  const handleFlag = async (flag: (typeof FLAGS)[number]) => {
    const next = !active[flag.key];
    if (flag.confirm && next && !window.confirm(flag.confirm)) return;

    setBusyFlag(flag.key);
    try {
      await setFlag({ hackathonId: active._id, [flag.key]: next });
      toast.success(`${flag.label} ${next ? "enabled" : "disabled"}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not change setting.",
      );
    } finally {
      setBusyFlag(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast.error("Give the hackathon a name.");
      return;
    }
    setCreating(true);
    try {
      await create({ name: newName.trim(), location: form.location });
      toast.success(`"${newName.trim()}" created as a draft.`);
      setNewName("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create hackathon.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell role="admin">
      <PageHeader
        title="Hackathon"
        description="Configuration, phase control and publication for this event."
        actions={
          <StatusBadge
            tone={HACKATHON_TONE[active.status] ?? HACKATHON_TONE.judging}
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="space-y-5">
          <SectionCard
            title="Details"
            description="Shown to participants and on the public event page."
            actions={
              <Button
                size="sm"
                disabled={savingDetails}
                onClick={() => void handleSaveDetails()}
              >
                {savingDetails ? "Saving…" : "Save details"}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="h-name">Name</Label>
                <Input
                  id="h-name"
                  value={form.name}
                  onChange={(e) => set("name")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-logo">Logo mark</Label>
                <Input
                  id="h-logo"
                  value={form.logo}
                  placeholder="RJ"
                  onChange={(e) => set("logo")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-location">Location</Label>
                <Input
                  id="h-location"
                  value={form.location}
                  onChange={(e) => set("location")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="h-tagline">Tagline</Label>
                <Input
                  id="h-tagline"
                  value={form.tagline}
                  onChange={(e) => set("tagline")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="h-desc">Description</Label>
                <Textarea
                  id="h-desc"
                  rows={3}
                  value={form.description}
                  onChange={(e) => set("description")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="h-problem">Problem statement</Label>
                <Textarea
                  id="h-problem"
                  rows={3}
                  value={form.problemStatement}
                  onChange={(e) => set("problemStatement")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-eligibility">Eligibility</Label>
                <Textarea
                  id="h-eligibility"
                  rows={4}
                  value={form.eligibility}
                  onChange={(e) => set("eligibility")(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="h-rules">Rules</Label>
                <Textarea
                  id="h-rules"
                  rows={4}
                  value={form.rules}
                  onChange={(e) => set("rules")(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                Schedule
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["startsAt", "Start date"],
                    ["endsAt", "End date"],
                    ["registrationClosesAt", "Registration deadline"],
                    ["submissionsCloseAt", "Submission deadline"],
                    ["judgingStartsAt", "Judging start"],
                    ["judgingEndsAt", "Judging end"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={`h-${key}`}>{label}</Label>
                    <Input
                      id={`h-${key}`}
                      type="datetime-local"
                      value={form[key]}
                      onChange={(e) => set(key)(e.target.value)}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="h-size">Maximum team size</Label>
                  <Input
                    id="h-size"
                    type="number"
                    min={1}
                    max={12}
                    value={form.maxTeamSize}
                    onChange={(e) => set("maxTeamSize")(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard
            title="Phases and visibility"
            description="Each switch takes effect immediately for every role."
          >
            <ul className="divide-y divide-border">
              {FLAGS.map((flag) => {
                const on = active[flag.key];
                return (
                  <li
                    key={flag.key}
                    className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{flag.label}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {flag.help}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={flag.label}
                      disabled={busyFlag === flag.key}
                      onClick={() => void handleFlag(flag)}
                      className={cn(
                        "mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:opacity-50",
                        on ? "bg-primary" : "bg-secondary",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
                          on && "translate-x-5",
                        )}
                      >
                        {on && <Check className="size-3 text-primary" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Results last published{" "}
              {active.resultsPublishedAt
                ? formatDateTime(active.resultsPublishedAt)
                : "never"}
              . Publishing only changes who can see the outcome — no scorecard is
              ever modified.
            </p>
          </SectionCard>

          <SectionCard
            title="All hackathons"
            description="One event is live at a time. Switching takes effect for every query."
          >
            <ul className="space-y-2">
              {all.map((hackathon) => (
                <li
                  key={hackathon._id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {hackathon.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {hackathon.isCurrent ? "Live now" : "Draft"} ·{" "}
                      {formatDate(hackathon.startsAt)}
                    </p>
                  </div>
                  {hackathon.isCurrent ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-success-foreground">
                      Current
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await setCurrent({ hackathonId: hackathon._id });
                          toast.success(
                            `${hackathon.name} is now the live hackathon.`,
                          );
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Could not switch.",
                          );
                        }
                      }}
                    >
                      <Power />
                      Make current
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <Label htmlFor="new-hackathon">Create a hackathon</Label>
              <div className="flex gap-2">
                <Input
                  id="new-hackathon"
                  value={newName}
                  placeholder="Rapture 2027"
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={creating}
                  onClick={() => void handleCreate()}
                >
                  {creating ? "Creating…" : "Create"}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                New hackathons start with every phase closed. Nothing is live
                until you make it current.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
