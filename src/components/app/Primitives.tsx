import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/rapture";

/** Flat colour block used for every status/state in the app. */
export function StatusBadge({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center border-2 border-ink px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        tone.className,
        className,
      )}
    >
      {tone.label}
    </span>
  );
}

/** A single number, with its label. The dashboard's basic unit. */
export function StatTile({
  label,
  value,
  hint,
  tone = "surface",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "surface" | "accent" | "ink";
}) {
  const tones = {
    surface: "bg-surface text-ink",
    accent: "bg-[#ffe500] text-ink",
    ink: "bg-ink text-white",
  } as const;

  return (
    <div className={cn("border-2 border-ink p-4", tones[tone])}>
      <p className="text-[11px] font-bold uppercase tracking-widest opacity-70">
        {label}
      </p>
      <p className="tabular mt-2 text-3xl font-black leading-none tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-2 text-xs font-medium opacity-70">{hint}</p>}
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
    <div className="mb-6 flex flex-col gap-4 border-b-2 border-ink pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
    <section className={cn("nb-card p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
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
    <div className="nb-inset px-6 py-10 text-center">
      <p className="text-sm font-bold uppercase tracking-wide">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

/** Horizontal progress meter drawn as flat blocks rather than a rounded bar. */
export function BlockProgress({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const safeTotal = Math.max(total, 0);
  const pct = safeTotal === 0 ? 0 : Math.round((done / safeTotal) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider">
        <span className="text-muted-foreground">{label ?? "Progress"}</span>
        <span className="tabular">
          {done}/{safeTotal} · {pct}%
        </span>
      </div>
      <div
        className="mt-2 h-3 w-full border-2 border-ink bg-surface"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full bg-[#2b6be4]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
