import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIK DESIGN SYSTEM
//
// The shared vocabulary for the redesign. Screens compose these instead of
// re-styling from scratch, which is what keeps the product feeling like one
// thing rather than a pile of separately-redesigned pages.
//
// Everything here is presentation only — no data fetching, no business rules.
// Colour comes from the theme tokens in index.css (monochrome: background,
// foreground, card, muted, border), so light and dark both work and nothing
// hard-codes a hue.
//
// Type scale, so it is decided once:
//   Display   .display-heading  uppercase italic tight  — page + section titles
//   Title     text-xl/2xl bold                          — card and modal titles
//   Body      text-sm                                   — prose
//   Label     <Label>  10px mono uppercase 0.18em       — every field/stat label
//   Numeric   font-mono                                 — all money, views, %
//
// Spacing: 6 (24px) between sections, 4 (16px) inside a card, 3 (12px) between
// tightly-related items. Radius: 3xl (24px) for surfaces, xl for controls.
// ─────────────────────────────────────────────────────────────────────────────

/* ── Typography ─────────────────────────────────────────────────────────── */

export const PageTitle = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <h1 className={cn("display-heading text-4xl leading-none sm:text-6xl", className)}>
    {children}
  </h1>
);

export const SectionTitle = ({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) => (
  <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-4">
    <h2 className="display-heading text-2xl sm:text-3xl">{children}</h2>
    {meta ? (
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {meta}
      </span>
    ) : null}
  </div>
);

/** Every field label, stat caption and micro-heading in the product. */
export const Label = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      "block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground",
      className
    )}
  >
    {children}
  </span>
);

/** Money, views, percentages — anything that should align in a column. */
export const Numeric = ({
  children,
  size = "md",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) => (
  <span
    className={cn(
      "block font-mono font-bold leading-none",
      size === "sm" && "text-base",
      size === "md" && "text-xl",
      size === "lg" && "text-2xl",
      size === "xl" && "text-4xl",
      className
    )}
  >
    {children}
  </span>
);

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export const Card = ({
  children,
  className,
  interactive,
  inverted,
}: {
  children: ReactNode;
  className?: string;
  /** Adds the hover lift used by anything clickable. */
  interactive?: boolean;
  /** The high-contrast treatment reserved for the single most important tile. */
  inverted?: boolean;
}) => (
  <div
    className={cn(
      "rounded-3xl border shadow-xl",
      inverted
        ? "border-transparent bg-foreground text-background"
        : "border-border bg-card",
      interactive &&
        "transition-all duration-300 hover:-translate-y-0.5 hover:border-foreground/30",
      className
    )}
  >
    {children}
  </div>
);

/** A labelled figure. The unit of every stats row in the product. */
export const Stat = ({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) => (
  <div>
    <Label>{label}</Label>
    <div className="mt-0.5">{value}</div>
    {hint ? (
      <span className="mt-0.5 block text-[11px] text-muted-foreground">
        {hint}
      </span>
    ) : null}
  </div>
);

export const StatRow = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
    {children}
  </div>
);

/* ── Controls ───────────────────────────────────────────────────────────── */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
  block?: boolean;
};

export const Button = ({
  variant = "primary",
  loading,
  block,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) => (
  <button
    {...props}
    disabled={disabled || loading}
    className={cn(
      "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-mono text-xs font-extrabold uppercase tracking-[0.18em] transition-all duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-40",
      variant === "primary" &&
        "bg-foreground text-background hover:scale-[0.99] active:scale-95",
      variant === "secondary" &&
        "border border-border bg-card text-foreground hover:border-foreground/40",
      variant === "ghost" &&
        "text-muted-foreground underline underline-offset-4 hover:text-foreground",
      block && "w-full",
      className
    )}
  >
    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
    {children}
  </button>
);

export const Input = ({
  label,
  hint,
  error,
  className,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="block space-y-1.5">
    <Label>{label}</Label>
    <input
      {...props}
      aria-invalid={Boolean(error)}
      className={cn(
        "w-full rounded-xl border bg-muted/40 px-4 py-3 text-sm text-foreground outline-none transition-colors",
        "placeholder:text-muted-foreground focus:border-foreground/40",
        error ? "border-destructive" : "border-border",
        className
      )}
    />
    {error ? (
      <span className="block text-[11px] text-destructive">{error}</span>
    ) : hint ? (
      <span className="block text-[11px] text-muted-foreground">{hint}</span>
    ) : null}
  </label>
);

/** Multi-select pill group — platforms, filters, anything small and toggleable. */
export const Chip = ({
  active,
  children,
  ...props
}: { active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    aria-pressed={active}
    {...props}
    className={cn(
      "rounded-lg border px-3 py-2 font-mono text-[11px] transition-colors",
      active
        ? "border-foreground bg-foreground text-background"
        : "border-border bg-muted/40 text-foreground/80 hover:border-foreground/40"
    )}
  >
    {children}
  </button>
);

export const Badge = ({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger";
}) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em]",
      tone === "neutral" && "bg-muted text-muted-foreground",
      tone === "positive" &&
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      tone === "warning" &&
        "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      tone === "danger" && "bg-destructive/15 text-destructive"
    )}
  >
    {children}
  </span>
);

/** The one progress bar in the product. `label`/`value` render the caption row. */
export const Progress = ({
  percent,
  label,
  value,
}: {
  percent: number;
  label?: ReactNode;
  value?: ReactNode;
}) => {
  const clamped = Number.isFinite(percent)
    ? Math.max(0, Math.min(percent, 100))
    : 0;
  return (
    <div className="space-y-1.5">
      {label || value ? (
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-bold">{value}</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-all duration-500"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};

/* ── States ─────────────────────────────────────────────────────────────── */

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
      {label}
    </span>
  </div>
);

export const Empty = ({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border py-16 text-center">
    <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
    {action}
  </div>
);

export const ErrorState = ({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-destructive/40 bg-destructive/5 py-12 text-center">
    <p className="max-w-sm text-sm text-destructive">{children}</p>
    {action}
  </div>
);

/** Skeleton block. Same radius as the surface it stands in for. */
export const Shimmer = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-3xl bg-muted", className)} />
);

/* ── Step indicator ─────────────────────────────────────────────────────── */

export const Steps = ({
  steps,
  current,
}: {
  steps: string[];
  current: number;
}) => (
  <ol className="flex items-center gap-2" aria-label="Progress">
    {steps.map((label, i) => (
      <li key={label} className="flex flex-1 items-center gap-2">
        <div
          aria-current={i === current ? "step" : undefined}
          title={label}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold transition-colors",
            i < current && "border-foreground bg-foreground text-background",
            i === current && "border-foreground text-foreground",
            i > current && "border-border text-muted-foreground"
          )}
        >
          {i + 1}
        </div>
        {i < steps.length - 1 ? (
          <div
            className={cn(
              "h-px flex-1",
              i < current ? "bg-foreground" : "bg-border"
            )}
          />
        ) : null}
      </li>
    ))}
  </ol>
);
