import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard } from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  guidance: string;
  maxScore: string;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  description: "",
  guidance: "",
  maxScore: "10",
};

export default function AdminRubric() {
  const data = useQuery(api.criteria.list);
  const createCriterion = useMutation(api.criteria.create);
  const updateCriterion = useMutation(api.criteria.update);
  const removeCriterion = useMutation(api.criteria.remove);
  const reorder = useMutation(api.criteria.reorder);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading rubric…
        </div>
      </AppShell>
    );
  }

  const { criteria, total, hasSubmittedScores } = data;

  const handleSave = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast.error("A criterion needs a name.");
      return;
    }
    const maxScore = Number(draft.maxScore);
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      toast.error("Maximum score must be a number above 0.");
      return;
    }

    setBusy(true);
    try {
      if (draft.id) {
        await updateCriterion({
          criterionId: draft.id as never,
          name,
          description: draft.description,
          guidance: draft.guidance || undefined,
          maxScore,
        });
        toast.success(`"${name}" updated.`);
      } else {
        await createCriterion({
          name,
          description: draft.description,
          guidance: draft.guidance || undefined,
          maxScore,
        });
        toast.success(`"${name}" added to the rubric.`);
      }
      setDraft(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save criterion.",
      );
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const row = criteria[index];
    const to = index + direction;
    if (!row || to < 0 || to >= criteria.length) return;
    try {
      await reorder({ criterionId: row._id, toIndex: to });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not reorder.",
      );
    }
  };

  return (
    <AppShell role="admin">
      <PageHeader
        title="Rubric"
        description="The criteria every judge scores against. Each one contributes exactly its maximum score to the total."
        actions={
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus />
            Add criterion
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <div className="space-y-5">
          {hasSubmittedScores && (
            <div className="flex items-start gap-3 rounded-lg border border-info/25 bg-info-soft px-4 py-3">
              <Lock className="mt-px size-4 shrink-0 text-info" />
              <p className="text-sm leading-relaxed text-info-foreground">
                Scorecards have already been submitted. You can still reshape
                the rubric — every submitted score keeps the maximum it was
                scored against, so nothing already filed is rescaled.
              </p>
            </div>
          )}

          <SectionCard
            title="Criteria"
            description="Display order is the order judges see them, top to bottom."
          >
            {criteria.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No criteria yet. Add the first one to start building the rubric.
              </p>
            ) : (
              <ul className="space-y-3">
                {criteria.map((criterion, index) => (
                  <li
                    key={criterion._id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-xs font-semibold text-muted-foreground">
                            {index + 1}.
                          </span>
                          <span className="text-sm font-medium">
                            {criterion.name}
                          </span>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-semibold text-secondary-foreground">
                            {criterion.maxScore} pts
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {criterion.description}
                        </p>
                        {criterion.guidance && (
                          <p className="mt-2 rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
                            {criterion.guidance}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${criterion.name} up`}
                          disabled={index === 0}
                          onClick={() => void move(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${criterion.name} down`}
                          disabled={index === criteria.length - 1}
                          onClick={() => void move(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDraft({
                              id: criterion._id as string,
                              name: criterion.name,
                              description: criterion.description,
                              guidance: criterion.guidance ?? "",
                              maxScore: String(criterion.maxScore),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${criterion.name}`}
                          className="text-destructive hover:bg-danger-soft"
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Delete "${criterion.name}"? Draft scorecards that scored it will keep their other scores.`,
                              )
                            ) {
                              return;
                            }
                            try {
                              await removeCriterion({
                                criterionId: criterion._id,
                              });
                              toast.success(`"${criterion.name}" deleted.`);
                            } catch (error) {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not delete criterion.",
                              );
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard title="Rubric total" description="Must be 100 for scores to be comparable across judges.">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "tabular text-4xl font-semibold tracking-tight",
                  total === 100 ? "text-success" : "text-warning",
                )}
              >
                {total}
              </span>
              <span className="text-sm text-muted-foreground">
                / 100 points
              </span>
            </div>
            {total !== 100 && (
              <p className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-warning-foreground">
                Criteria currently sum to {total}. Adjust the maximum scores so
                the rubric totals 100.
              </p>
            )}
            {criteria.length > 0 && total === 100 && (
              <p className="mt-3 rounded-md border border-success/25 bg-success-soft px-3 py-2.5 text-xs leading-relaxed text-success-foreground">
                The rubric is balanced. Judges scoring every criterion will
                produce a total out of 100.
              </p>
            )}
          </SectionCard>

          {draft && (
            <SectionCard
              title={draft.id ? "Edit criterion" : "New criterion"}
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </Button>
              }
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="c-name">Name</Label>
                  <Input
                    id="c-name"
                    value={draft.name}
                    placeholder="Innovation"
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-desc">Description</Label>
                  <Textarea
                    id="c-desc"
                    rows={2}
                    value={draft.description}
                    placeholder="What this criterion measures."
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-guidance">Evaluation guidance</Label>
                  <Textarea
                    id="c-guidance"
                    rows={3}
                    value={draft.guidance}
                    placeholder="What a strong and a weak answer look like. Shown to the judge while scoring."
                    onChange={(e) =>
                      setDraft({ ...draft, guidance: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="c-max">Maximum score</Label>
                  <Input
                    id="c-max"
                    type="number"
                    min={1}
                    max={100}
                    value={draft.maxScore}
                    onChange={(e) =>
                      setDraft({ ...draft, maxScore: e.target.value })
                    }
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={busy}
                  onClick={() => void handleSave()}
                >
                  {busy ? "Saving…" : draft.id ? "Save changes" : "Add criterion"}
                </Button>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </AppShell>
  );
}
