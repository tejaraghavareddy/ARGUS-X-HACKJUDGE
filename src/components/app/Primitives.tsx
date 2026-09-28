import { useEffect, useState, type ReactNode } from "react";
import { AlarmClock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/rapture";

/** Flat status pill. Colour comes from the semantic tokens, shape from the CSS.
 *  `children` overrides the tone's own label (used by the audit log). */
export function StatusBadge({
  tone,
  className,
  children,
}: {
  tone: Tone;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={cn("status-pill", tone.className, className)}>
      {children ?? tone.label}
    </span>
  );
}

/** A single number with its label — the dashboard's basic unit. */
export function StatTile({
  label,
  value,
  hint,
  tone = "surface",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "surface" | "accent" | "primary";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border p-4",
        tone === "primary" && "bg-primary text-primary-foreground border-primary",
        tone === "accent" && "bg-accent text-accent-foreground border-transparent",
        tone === "surface" && "bg-card",
      )}
    >
      <p
        className={cn(
          "text-xs font-medium",
          tone === "primary" || tone === "accent"
            ? "opacity-75"
            : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="tabular mt-2 text-2xl font-semibold leading-none tracking-tight sm:text-3xl">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs opacity-65">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.021em] sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-card p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.015em]">{title}</h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="surface-inset px-6 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

/** Progress meter. Uses the progress token so it matches the brand, not a bar. */
export function BlockProgress({
  done,
  total,
  label,
  className,
  hideCount,
}: {
  done: number;
  total: number;
  label?: string;
  className?: string;
  /** For percentage-style progress, where "42/100" is noise. */
  hideCount?: boolean;
}) {
  const safeTotal = Math.max(total, 0);
  const pct = safeTotal === 0 ? 0 : Math.round((done / safeTotal) * 100);

  return (
    <div className={className}>
      {(label || safeTotal > 0) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{label ?? "Progress"}</span>
          <span className="tabular font-medium">
            {hideCount ? (
              <>{pct}%</>
            ) : (
              <>
                {done}/{safeTotal}
                {safeTotal > 0 && (
                  <span className="ml-1 text-muted-foreground">{pct}%</span>
                )}
              </>
            )}
          </span>
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progress"}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Live countdown to a deadline.
 *
 * Ticks every second rather than every minute: a team working at 11:59pm needs
 * to see the seconds, and the urgency is the whole point. The interval is
 * cleared on unmount so navigating away does not leak a timer. Precision
 * scales down as the deadline gets further away — seconds past a week, or
 * minutes past a month, are just noise.
 */
export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = to - now;

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3.5">
        <CheckCircle2 className="size-5 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-semibold text-foreground">
            The deadline has passed
          </p>
          <p className="text-xs text-muted-foreground">
            Contact the organizers if you believe this is wrong.
          </p>
        </div>
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const showSeconds = remaining < 86_400_000;
  const showMinutes = remaining < 2_592_000_000;
  const urgent = remaining < 86_400_000;
  const critical = remaining < 3_600_000;

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-4",
        critical
          ? "border-destructive/50 bg-destructive/10"
          : urgent
            ? "border-warning/50 bg-warning/10"
            : "border-border bg-muted",
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <AlarmClock className="size-3.5" />
        Time remaining
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">
        {days > 0 && (
          <>
            <span>{days}</span>
            <span className="font-sans text-base font-medium text-muted-foreground">
              {days === 1 ? "day" : "days"}
            </span>
            <span className="font-sans text-muted-foreground">·</span>
          </>
        )}
        <span>{String(hours).padStart(2, "0")}</span>
        <span className="font-sans text-base font-medium text-muted-foreground">
          h
        </span>
        {showMinutes && (
          <>
            <span>{String(minutes).padStart(2, "0")}</span>
            <span className="font-sans text-base font-medium text-muted-foreground">
              m
            </span>
          </>
        )}
        {showSeconds && (
          <>
            <span>{String(seconds).padStart(2, "0")}</span>
            <span className="font-sans text-base font-medium text-muted-foreground">
              s
            </span>
          </>
        )}
      </div>
    </div>
  );
}
