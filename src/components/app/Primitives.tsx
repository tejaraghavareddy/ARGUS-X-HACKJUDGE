import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/rapture";

/** Flat status pill. Colour comes from the semantic tokens, shape from the CSS. */
export function StatusBadge({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  return (
    <span className={cn("status-pill", tone.className, className)}>
      {tone.label}
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
}: {
  done: number;
  total: number;
  label?: string;
  className?: string;
}) {
  const safeTotal = Math.max(total, 0);
  const pct = safeTotal === 0 ? 0 : Math.round((done / safeTotal) * 100);

  return (
    <div className={className}>
      {(label || safeTotal > 0) && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{label ?? "Progress"}</span>
          <span className="tabular font-medium">
            {done}/{safeTotal}
            {safeTotal > 0 && (
              <span className="ml-1 text-muted-foreground">{pct}%</span>
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
