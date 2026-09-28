import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  Bot,
  Quote,
  RefreshCw,
  Send,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { NO_EVIDENCE } from "@/convex/lib/copilot";
import { cn } from "@/lib/utils";

type QuoteRef = { quote: string; source: { sourceId: string; source: string; page?: number } };

type ChatEntry = {
  role: "user" | "model";
  text: string;
  quotes?: QuoteRef[];
  notInSource?: boolean;
  dropped?: number;
};

/**
 * The three evidence tiers the product distinguishes, shown as a legend so a
 * judge always knows what kind of statement they are reading.
 */
function TierLegend() {
  const tiers = [
    { label: "Submission evidence", desc: "verbatim, from the team's materials — checked word-for-word", cls: "text-success-foreground" },
    { label: "AI interpretation", desc: "the machine's neutral reading — verify before relying on it", cls: "text-info-foreground" },
    { label: "Human assessment", desc: "the scorecard is yours alone; the AI never writes here", cls: "text-foreground" },
  ];
  return (
    <div className="mt-3 grid gap-1.5 rounded-md border border-border bg-muted px-3 py-2.5 sm:grid-cols-3">
      {tiers.map((t, i) => (
        <p key={t.label} className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          <span className={`font-semibold ${t.cls}`}>{i + 1}. {t.label}</span>
          {" — "}
          {t.desc}
        </p>
      ))}
    </div>
  );
}

/** A small chip naming the document (and page) a quote was verified against. */
function SourceChip({ source }: { source: { source: string; page?: number } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[0.625rem] text-secondary-foreground">
      {source.source}
      {source.page !== undefined && <span className="font-semibold">p.{source.page}</span>}
    </span>
  );
}

/**
 * The AI Judge Copilot.
 *
 * Renders the generated analysis (project summary, per-criterion rubric
 * evidence, missing-evidence detection, questions for the team) and hosts the
 * grounded chat about THIS submission. Everything is machine-labelled and
 * advisory-only: there is no score here and no way to write one — the data
 * comes from `judgingBriefs`, a table the scoring code never reads.
 *
 * The panel never talks to the AI vendor directly. It calls Convex functions
 * (`api.copilot.*`); the Gemini key lives only in the server environment.
 */
export function CopilotPanel({ teamId }: { teamId: Id<"teams"> }) {
  const brief = useQuery(api.copilot.briefForSubmission, { teamId });
  // generate/chat are Convex actions (they call the AI vendor server-side),
  // so they are wired with useAction, not useMutation.
  const generate = useAction(api.copilot.generate);
  const sendChat = useAction(api.copilot.chat);

  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const criteriaNames = Object.keys(brief?.criteria ?? {}).sort();

  // Keep the selected criterion tab pointing at a criterion that exists.
  useEffect(() => {
    if (criteriaNames.length === 0) {
      setActiveTab(null);
    } else if (!activeTab || !criteriaNames.includes(activeTab)) {
      setActiveTab(criteriaNames[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief === undefined, criteriaNames.join("|")]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, chatBusy]);

  if (brief === undefined) {
    return (
      <section className="surface-card p-5">
        <p className="text-sm text-muted-foreground">Loading AI copilot…</p>
      </section>
    );
  }

  // No live hackathon: the copilot has nothing to be scoped to.
  if (brief === null) {
    return (
      <section className="surface-card p-5">
        <p className="text-sm text-muted-foreground">
          The AI copilot is unavailable because no hackathon is currently
          active.
        </p>
      </section>
    );
  }

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generate({ teamId });
      if (result.ok) {
        toast.success("Analysis generated. Verify every claim yourself.");
      } else {
        toast.error(result.error ?? "Could not generate the analysis.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate the analysis.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    const question = chatInput.trim();
    if (!question || chatBusy) return;
    setChatInput("");
    setChatBusy(true);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    try {
      const result = await sendChat({
        teamId,
        message: question,
        history: messages
          .filter((m) => m.text.trim())
          .map((m) => ({ role: m.role, text: m.text })),
      });
      if (result.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            text: result.answer,
            quotes: result.quotes,
            notInSource: result.notInSource,
            dropped: result.dropped,
          },
        ]);
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The copilot could not answer.",
      );
    } finally {
      setChatBusy(false);
    }
  };

  const active = activeTab ? brief.criteria?.[activeTab] : undefined;

  return (
    <section className="surface-card overflow-hidden" id="copilot">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-info-soft px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-info-foreground">
          <Sparkles className="size-3.5" />
          AI Judge Copilot
        </span>
        <span className="rounded-full bg-card px-2 py-0.5 text-[0.6875rem] font-semibold text-muted-foreground">
          Advisory only — never a score
        </span>
      </header>

      <div className="p-4">
        <p className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs leading-relaxed text-warning-foreground">
          <ShieldQuestion className="mt-px size-4 shrink-0" />
          <span>
            Machine-generated briefing and evidence for this submission. It
            carries no score and cannot change one — the scorecard is entirely
            yours. Every claim is checked verbatim against the submitted text;
            anything that does not verify is dropped before you see it.
          </span>
        </p>

        {brief.state === "missing" && (
          <div className="surface-inset mt-4 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No AI analysis has been generated for this submission yet.
            </p>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="mt-3"
            >
              <Sparkles />
              {generating ? "Generating…" : "Generate analysis"}
            </Button>
            <p className="mt-2 text-[0.6875rem] text-muted-foreground">
              Runs server-side against the submission text and the live rubric.
            </p>
          </div>
        )}

        {brief.state === "failed" && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive-foreground">
              <AlertTriangle className="size-3.5" />
              The last generation attempt failed
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-destructive-foreground/90">
              {brief.error}
            </p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => void handleGenerate()}
              disabled={generating}
            >
              <RefreshCw />
              {generating ? "Retrying…" : "Retry generation"}
            </Button>
          </div>
        )}

        {brief.state === "ready" && brief.brief && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
              <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-secondary-foreground">
                {brief.provider} · {brief.model}
              </span>
              <span>
                Generated {new Date(brief.generatedAt).toLocaleString()}
              </span>
              {brief.droppedUnverified > 0 && (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning-foreground">
                  {brief.droppedUnverified} unverified claim
                  {brief.droppedUnverified === 1 ? "" : "s"} dropped
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <BriefBlock
                title="Executive summary"
                text={brief.brief.executiveSummary}
              />
              <BriefBlock title="Problem" text={brief.brief.problemSummary} />
              <BriefBlock title="Solution" text={brief.brief.solution} />
              <BriefBlock
                title="Architecture"
                text={brief.brief.architectureSummary}
              />
            </div>

            {brief.brief.missingInformation.length > 0 && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-xs font-semibold">
                  Not provided in the submission
                </p>
                <ul className="mt-1.5 space-y-1">
                  {brief.brief.missingInformation.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <span
                        aria-hidden
                        className="font-semibold text-destructive"
                      >
                        !
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold">Rubric evidence by criterion</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {criteriaNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setActiveTab(name)}
                    aria-pressed={activeTab === name}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      activeTab === name
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-input bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>

              {active && (
                <div className="mt-2.5 rounded-md border border-border bg-card p-3">
                  <ClaimList title="Evidence" claims={active.evidence} />
                  <ClaimList
                    title="Possible strengths"
                    claims={active.strengths}
                  />
                  <ClaimList title="Points to probe" claims={active.concerns} />

                  {active.missingEvidence.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2.5">
                      <p className="text-xs font-semibold">
                        Missing evidence for this criterion
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {active.missingEvidence.map((item) => (
                          <li
                            key={item}
                            className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="font-semibold text-destructive"
                            >
                              !
                            </span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {active.questions.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2.5">
                      <p className="text-xs font-semibold">Ask the team</p>
                      <ul className="mt-1.5 space-y-1">
                        {active.questions.map((q) => (
                          <li
                            key={q}
                            className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="font-semibold text-info"
                            >
                              ?
                            </span>
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Grounded chat about this submission */}
        <div className="mt-4 rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Bot className="size-3.5" />
              Ask about this submission
            </p>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <div ref={scrollRef} className="max-h-72 overflow-y-auto p-3">
            {messages.length === 0 && !chatBusy && (
              <p className="text-xs text-muted-foreground">
                Answers come only from the submission text, with verbatim
                quotes. Try “What does the team say about testing?”
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={cn("mb-2.5 last:mb-0", m.role === "user" && "text-right")}
              >
                <div
                  className={cn(
                    "inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-xs leading-relaxed",
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-line">{m.text}</p>
                  {m.quotes && m.quotes.length > 0 && (
                    <ul className="mt-1.5 space-y-1 border-t border-border/40 pt-1.5">
                      {m.quotes.map((q) => (
                        <li
                          key={`${q.quote}::${q.source.sourceId}`}
                          className="text-[0.6875rem] text-muted-foreground"
                        >
                          <p className="flex gap-1.5">
                            <Quote className="mt-px size-3 shrink-0" />
                            <span>“{q.quote}”</span>
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 pl-4.5">
                            <span className="font-semibold">Source:</span>
                            <SourceChip source={q.source} />
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.notInSource && (
                    <p className="mt-1.5 text-[0.6875rem] font-medium text-warning-foreground">
                      Not stated in the submission.
                    </p>
                  )}
                  {m.dropped ? (
                    <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
                      {m.dropped} unverified {m.dropped === 1 ? "quote" : "quotes"}{" "}
                      dropped
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            {chatBusy && <p className="text-xs text-muted-foreground">Thinking…</p>}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                brief.state === "ready"
                  ? "Ask anything the submission should answer…"
                  : "Generate the analysis first, then ask questions…"
              }
              maxLength={2000}
              disabled={chatBusy || brief.state !== "ready"}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs outline-none transition-colors focus:border-primary/50"
            />
            <Button
              type="submit"
              size="sm"
              disabled={chatBusy || !chatInput.trim() || brief.state !== "ready"}
              className="shrink-0"
            >
              <Send />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}

function BriefBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="surface-inset p-3">
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        {text.trim() || NO_EVIDENCE}
      </p>
    </div>
  );
}

function ClaimList({
  title,
  claims,
}: {
  title: string;
  claims: { claim: string; sourceQuote: string }[];
}) {
  if (claims.length === 0) return null;
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-xs font-semibold">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {claims.map((c) => (
          <li key={c.claim} className="rounded-md bg-muted px-2.5 py-1.5">
            <p className="text-xs leading-relaxed">{c.claim}</p>
            <p className="mt-1 flex gap-1.5 text-[0.6875rem] leading-relaxed text-muted-foreground">
              <Quote className="mt-px size-3 shrink-0" />
              <span>“{c.sourceQuote}”</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
