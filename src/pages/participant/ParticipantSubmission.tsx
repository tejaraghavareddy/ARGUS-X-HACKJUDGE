import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileUp,
  Loader2,
  Lock,
  Paperclip,
  Save,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  Countdown,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { AdvisoryPanel } from "@/components/app/AdvisoryPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FILE_KINDS,
  SUBMISSION_FIELDS,
  URL_FIELDS,
  checkFile,
  checkUrl,
  formatBytes,
  fieldError,
  type FileKind,
  type SubmissionValues,
} from "@/convex/lib/participant";
import { SUBMISSION_TONE, formatDateTime } from "@/lib/rapture";
import { cn } from "@/lib/utils";

type View = "edit" | "preview" | "confirm";

/**
 * The structured submission.
 *
 * Three deliberate rules:
 *  1. Nothing is ever sent to the server on every keystroke. The team saves
 *     deliberately, and the server is still the authority on every rule.
 *  2. Final submit is a separate screen, not a button. It is the last moment
 *     before the work locks, so it shows exactly what is about to be sealed.
 *  3. Once locked, the form is rendered read-only rather than hidden, so a
 *     team can always see what they submitted.
 */
export default function ParticipantSubmission() {
  const data = useQuery(api.submissions.mySubmission);
  const saveDraft = useMutation(api.submissions.saveDraft);
  const finalSubmit = useMutation(api.submissions.finalSubmit);
  const requestUploadUrl = useMutation(api.submissions.requestUploadUrl);
  const recordFile = useMutation(api.submissions.recordFile);
  const deleteFile = useMutation(api.submissions.deleteFile);

  const [values, setValues] = useState<SubmissionValues>({});
  const [view, setView] = useState<View>("edit");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState<FileKind | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Hydrate the form from the server's copy once it arrives. Keyed on the
  // submission id so a live query update never clobbers in-flight edits, and
  // guarded on `dirty` so re-renders cannot discard typing either.
  const submissionId = data?.submission?.id ?? null;
  const serverValues = data?.values;
  useEffect(() => {
    if (!serverValues || dirty) return;
    setValues(serverValues);
  }, [submissionId, serverValues, dirty]);

  if (data === undefined) {
    return (
      <AppShell role="participant">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading your submission…
        </div>
      </AppShell>
    );
  }

  const { team, submission, hackathon, files, completion, blockingErrors } = data;

  if (!team) {
    return (
      <AppShell role="participant">
        <SectionCard title="No team yet">
          <p className="text-sm text-muted-foreground">
            Create a team before starting a submission.
          </p>
          <div className="mt-4">
            <Button asChild>
              <Link to="/participant/team">Create a team</Link>
            </Button>
          </div>
        </SectionCard>
      </AppShell>
    );
  }

  const locked = Boolean(submission && submission.status !== "draft");
  const editable = !locked;

  const set = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setBusy("save");
    try {
      await saveDraft(values);
      setDirty(false);
      toast.success("Draft saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const handleUpload = async (kind: FileKind, file: File) => {
    const spec = FILE_KINDS.find((f) => f.key === kind)!;
    const check = checkFile(kind, file.name, file.size);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setUploading(kind);
    try {
      const { uploadUrl } = await requestUploadUrl({ kind });
      const response = await fetch(uploadUrl, {
        method: "POST",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!response.ok) throw new Error("The upload did not complete.");
      const { storageId } = (await response.json()) as { storageId: string };
      await recordFile({
        storageId,
        kind,
        name: file.name,
        size: file.size,
        contentType: file.type,
      });
      toast.success(`${spec.label} uploaded.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Upload failed. Try again.",
      );
    } finally {
      setUploading(null);
      if (fileInputs.current[kind]) fileInputs.current[kind]!.value = "";
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    try {
      await deleteFile({ fileId: fileId as never });
      toast.success("File removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove.");
    }
  };

  const handleFinalSubmit = async () => {
    setBusy("submit");
    try {
      const result = await finalSubmit({});
      toast.success(`Submitted. Your ID is ${result.submissionRef}.`);
      setView("edit");
      setAcknowledge(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit.");
    } finally {
      setBusy(null);
    }
  };

  const goToConfirm = () => {
    if (dirty) {
      toast.error("Save your draft before submitting.");
      return;
    }
    const errors = Object.keys(blockingErrors);
    if (errors.length > 0) {
      toast.error(`Cannot submit yet: ${Object.values(blockingErrors)[0]}`);
      return;
    }
    setView("confirm");
    window.scrollTo({ top: 0 });
  };

  // --- Finalized: a receipt, not an editor. --------------------------------
  if (locked) {
    return (
      <AppShell role="participant">
        <PageHeader
          title={team.projectName || "Your submission"}
          description={`${team.name} — submitted ${formatDateTime(submission?.submittedAt)}`}
          actions={
            <StatusBadge tone={SUBMISSION_TONE[submission?.status ?? "submitted"]} />
          }
        />

        <div className="mb-5 flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3.5">
          <Lock className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              This submission is locked
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Sealed with ID{" "}
              <span className="font-mono font-semibold text-foreground">
                {submission?.submissionRef}
              </span>{" "}
              at {formatDateTime(submission?.submittedAt)}. Nothing here can be
              changed unless an administrator explicitly reopens it.
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          <div className="space-y-5">
            <SectionCard title="What you submitted">
              <dl className="space-y-5">
                {SUBMISSION_FIELDS.map((spec) => {
                  const raw = (values[spec.key] ?? "").trim();
                  if (!raw) return null;
                  return (
                    <div key={spec.key}>
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {spec.label}
                      </dt>
                      <dd className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-foreground">
                        {raw}
                      </dd>
                    </div>
                  );
                })}
                {URL_FIELDS.some((u) => values[u.key]) && (
                  <div>
                    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Links
                    </dt>
                    <dd className="mt-1.5 space-y-1">
                      {URL_FIELDS.filter((u) => values[u.key]).map((u) => (
                        <a
                          key={u.key}
                          href={values[u.key]}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate font-mono text-sm text-primary hover:underline"
                        >
                          {u.label}: {values[u.key]}
                        </a>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </SectionCard>

            <SectionCard title="Attached files">
              {files.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No files were attached to this submission.
                </p>
              ) : (
                <ul className="space-y-2">
                  {files.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm">{file.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="space-y-5">
            {hackathon && <Countdown to={hackathon.submissionsCloseAt} />}
            <AdvisoryPanel review={submission?.aiReview} audience="participant" />
            <Button asChild variant="outline" className="w-full">
              <Link to="/participant">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  // --- Confirmation: the last screen before it is sealed. -------------------
  if (view === "confirm") {
    const uploaded = new Set(files.map((f) => f.kind));
    return (
      <AppShell role="participant">
        <PageHeader
          title="Ready to submit?"
          description="This is the last step. After you confirm, your submission is sealed."
        />

        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr] lg:items-start">
          <div className="space-y-5">
            <SectionCard title="What will be sealed">
              <dl className="space-y-4">
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
                  <dt className="text-sm text-muted-foreground">Project</dt>
                  <dd className="text-sm font-medium">
                    {values.projectName || "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
                  <dt className="text-sm text-muted-foreground">Team</dt>
                  <dd className="text-sm font-medium">{team.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
                  <dt className="text-sm text-muted-foreground">
                    Written answers
                  </dt>
                  <dd className="text-sm font-medium">
                    {
                      SUBMISSION_FIELDS.filter(
                        (f) => (values[f.key] ?? "").trim().length > 0,
                      ).length
                    }
                    / {SUBMISSION_FIELDS.length}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3">
                  <dt className="text-sm text-muted-foreground">Links</dt>
                  <dd className="text-sm font-medium">
                    {URL_FIELDS.filter((u) => (values[u.key] ?? "").trim())
                      .length}{" "}
                    provided
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-muted-foreground">Files</dt>
                  <dd className="text-sm font-medium">{files.length} attached</dd>
                </div>
              </dl>

              <ul className="mt-5 space-y-2 border-t border-border pt-4">
                {FILE_KINDS.map((spec) => (
                  <li key={spec.key} className="flex items-center gap-2 text-sm">
                    {uploaded.has(spec.key) ? (
                      <CheckCircle2 className="size-4 shrink-0 text-success" />
                    ) : (
                      <AlertTriangle className="size-4 shrink-0 text-warning" />
                    )}
                    <span className="text-foreground">{spec.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {spec.required ? "Required" : "Optional"}
                      {!uploaded.has(spec.key) && spec.required
                        ? " — missing"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-muted px-4 py-3.5">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-sm leading-relaxed text-foreground">
                I understand that submitting locks this submission. I cannot
                edit it afterwards — if something is wrong, an administrator
                has to reopen it, and they may not be available before the
                deadline.
              </span>
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setView("edit")}
                disabled={busy !== null}
              >
                <ArrowLeft />
                Back to the form
              </Button>
              <Button
                className="flex-1"
                disabled={!acknowledge || busy !== null}
                onClick={() => void handleFinalSubmit()}
              >
                {busy === "submit" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Send />
                )}
                Confirm and submit
              </Button>
            </div>
          </div>

          <div className="space-y-5">
            {hackathon && <Countdown to={hackathon.submissionsCloseAt} />}
            <SectionCard title="Summary">
              <BlockProgress
                done={completion}
                total={100}
                label="Submission complete"
                hideCount
              />
            </SectionCard>
          </div>
        </div>
      </AppShell>
    );
  }

  // --- Edit / preview -------------------------------------------------------
  const readOnly = view === "preview";

  return (
    <AppShell role="participant">
      <PageHeader
        title={values.projectName || team.name}
        description={
          readOnly
            ? "Preview of exactly what judges will see."
            : dirty
              ? "Unsaved changes. Save your draft when you are ready."
              : "Save as often as you like. Nothing is final until you confirm."
        }
        actions={
          readOnly ? (
            <StatusBadge tone={SUBMISSION_TONE.draft} />
          ) : dirty ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
              Unsaved
            </span>
          ) : (
            <StatusBadge tone={SUBMISSION_TONE.draft} />
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div className="space-y-5">
          {submission?.reopenedAt && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-sm text-foreground">
                <span className="font-medium">Reopened by an administrator.</span>{" "}
                {submission.reopenNote}
              </p>
            </div>
          )}

          <SectionCard
            title="Project"
            description="How your project is identified across the event."
          >
            <div className="space-y-4">
              {SUBMISSION_FIELDS.filter((f) => f.key === "projectName" || f.key === "techStack").map(
                (spec) => (
                  <Field
                    key={spec.key}
                    spec={spec}
                    value={values[spec.key] ?? ""}
                    onChange={(v) => set(spec.key, v)}
                    readOnly={readOnly}
                  />
                ),
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Your submission"
            description="Judges read these in order. Specifics beat adjectives."
          >
            <div className="space-y-5">
              {SUBMISSION_FIELDS.filter(
                (f) => f.key !== "projectName" && f.key !== "techStack",
              ).map((spec) => (
                <Field
                  key={spec.key}
                  spec={spec}
                  value={values[spec.key] ?? ""}
                  onChange={(v) => set(spec.key, v)}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="External resources"
            description="Link straight to the things you would demo."
          >
            <div className="space-y-4">
              {URL_FIELDS.map((url) => {
                const raw = values[url.key] ?? "";
                const result = raw.trim() ? checkUrl(raw, url.hosts) : null;
                const invalid = result !== null && !result.ok;
                return (
                  <div key={url.key} className="space-y-1.5">
                    <Label htmlFor={url.key}>
                      {url.label}
                      {url.required && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </Label>
                    {readOnly ? (
                      raw.trim() ? (
                        <a
                          href={raw}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate font-mono text-sm text-primary hover:underline"
                        >
                          {raw}
                        </a>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Not provided
                        </p>
                      )
                    ) : (
                      <>
                        <Input
                          id={url.key}
                          value={raw}
                          inputMode="url"
                          placeholder={url.placeholder}
                          aria-invalid={invalid}
                          className={cn(invalid && "border-destructive")}
                          onChange={(e) => set(url.key, e.target.value)}
                        />
                        {invalid && (
                          <p className="text-xs text-destructive">
                            {result.error}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Files"
            description="Judges weigh these as evidence, not decoration."
          >
            <div className="space-y-4">
              {FILE_KINDS.map((spec) => {
                const attached = files.filter((f) => f.kind === spec.key);
                return (
                  <div
                    key={spec.key}
                    className="rounded-lg border border-border p-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {spec.label}
                          {spec.required && (
                            <span className="text-destructive">*</span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {spec.description} Up to {formatBytes(spec.maxBytes)}.
                        </p>
                      </div>
                      {editable && (
                        <>
                          <input
                            ref={(el) => {
                              fileInputs.current[spec.key] = el;
                            }}
                            type="file"
                            accept={spec.accept}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleUpload(spec.key, file);
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={uploading === spec.key}
                            onClick={() =>
                              fileInputs.current[spec.key]?.click()
                            }
                          >
                            {uploading === spec.key ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Upload />
                            )}
                            {attached.length > 0 ? "Replace" : "Upload"}
                          </Button>
                        </>
                      )}
                    </div>

                    {attached.length === 0 ? (
                      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                        <FileUp className="size-3.5" />
                        Nothing attached yet
                      </p>
                    ) : (
                      <ul className="mt-3 space-y-1.5">
                        {attached.map((file) => (
                          <li
                            key={file.id}
                            className="flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-1.5"
                          >
                            <a
                              href={file.url ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
                            >
                              {file.name}
                            </a>
                            <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                              {formatBytes(file.size)}
                            </span>
                            {editable && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRemoveFile(file.id)
                                }
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                                aria-label={`Remove ${file.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <div className="sticky bottom-0 -mx-4 border-t border-border bg-card/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              {editable && (
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy !== null || !dirty}
                  onClick={() => void handleSave()}
                >
                  {busy === "save" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Save />
                  )}
                  Save draft
                </Button>
              )}
              {editable ? (
                <Button
                  className="flex-1"
                  onClick={() =>
                    readOnly ? goToConfirm() : setView("preview")
                  }
                  disabled={busy !== null}
                >
                  {readOnly ? <Send /> : <Eye />}
                  {readOnly ? "Review and submit" : "Preview"}
                </Button>
              ) : (
                <Button asChild className="flex-1">
                  <Link to="/participant">Back to dashboard</Link>
                </Button>
              )}
              {readOnly && (
                <Button
                  variant="ghost"
                  onClick={() => setView("edit")}
                  disabled={busy !== null}
                >
                  <ArrowLeft />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {hackathon && <Countdown to={hackathon.submissionsCloseAt} />}

          <SectionCard title="Completion">
            <BlockProgress
              done={completion}
              total={100}
              label="Ready to submit"
              hideCount
            />
            {Object.keys(blockingErrors).length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {Object.keys(blockingErrors).length} item
                {Object.keys(blockingErrors).length === 1 ? "" : "s"} still
                blocking submission. Save your draft to see the full list.
              </p>
            )}
          </SectionCard>

          {hackathon?.problemStatement && (
            <SectionCard title="The challenge">
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                {hackathon.problemStatement}
              </p>
            </SectionCard>
          )}

          <AdvisoryPanel review={submission?.aiReview} audience="participant" />
        </div>
      </div>
    </AppShell>
  );
}

/** One labelled narrative field, with live length feedback and inline errors. */
function Field({
  spec,
  value,
  onChange,
  readOnly,
}: {
  spec: (typeof SUBMISSION_FIELDS)[number];
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const error = fieldError(spec, value);
  const over = value.trim().length > spec.maxLength;
  // Only nag once someone has actually typed something; an untouched required
  // field is a reminder, not a mistake.
  const showError = !readOnly && value.trim().length > 0 && (error !== null || over);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={spec.key}>
          {spec.label}
          {spec.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        <span
          className={cn(
            "shrink-0 text-[0.6875rem] tabular",
            over ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {value.trim().length} / {spec.maxLength}
        </span>
      </div>

      {readOnly ? (
        <p className="text-sm leading-relaxed whitespace-pre-line text-foreground">
          {value.trim() || (
            <span className="text-muted-foreground">Not answered</span>
          )}
        </p>
      ) : spec.long ? (
        <Textarea
          id={spec.key}
          rows={Math.min(12, Math.max(3, Math.ceil(value.length / 70)))}
          value={value}
          placeholder={spec.placeholder}
          aria-invalid={showError}
          className={cn(showError && "border-destructive")}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={spec.key}
          value={value}
          placeholder={spec.placeholder}
          aria-invalid={showError}
          className={cn(showError && "border-destructive")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {showError ? (
        <p className="text-xs text-destructive">{error ?? "Too long."}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{spec.hint}</p>
      )}
    </div>
  );
}
