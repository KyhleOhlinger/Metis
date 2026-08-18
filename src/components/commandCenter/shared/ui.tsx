import type { ReactNode } from "react";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[10px] font-medium text-text-muted">
      {children}
    </span>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[9px] leading-relaxed text-text-muted">{children}</p>;
}

/** Native `<select>` styling for Command Center panels. */
export const ccSelectCls =
  "mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-[10px] text-text-primary focus:border-accent focus:outline-none";

export const ccInputCls =
  "w-full rounded border border-border bg-surface-overlay px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none";

export const ccTextareaCls =
  "w-full resize-none rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none";

export function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted/80">
      {children}
    </p>
  );
}

export function InlineBanner({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent";
}) {
  const toneCls =
    tone === "accent"
      ? "border-accent/25 bg-accent/10"
      : "border-border/60 bg-surface-base/40";
  return (
    <div
      className={[
        "rounded border px-2.5 py-2 text-[10px] leading-relaxed text-text-muted",
        toneCls,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

export function SegmentButton({
  active,
  children,
  onClick,
  disabled,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded px-2 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "bg-accent/20 font-medium text-accent"
          : "bg-surface-base/50 text-text-muted hover:text-text-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export function SectionAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] font-medium text-accent transition-colors hover:underline"
    >
      {children}
    </button>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        {title}
      </p>
      <div className="rounded-md border border-border bg-surface-overlay p-2.5 space-y-2">
        {children}
      </div>
    </div>
  );
}

export function KV({
  label,
  value,
  mono = false,
  highlight = false,
  stacked = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  /** Label above value — better for paths and long text. */
  stacked?: boolean;
}) {
  const valueCls = [
    mono ? "font-mono" : "",
    highlight ? "text-accent" : "text-text-secondary",
  ]
    .filter(Boolean)
    .join(" ");

  if (stacked) {
    return (
      <div className="space-y-0.5">
        <FieldLabel>{label}</FieldLabel>
        <p className={["break-all text-[10px] leading-snug", valueCls].join(" ")} title={value}>
          {value}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 pt-px text-[10px] text-text-muted">{label}</span>
      <span
        className={["min-w-0 truncate text-right text-[10px] leading-snug", valueCls].join(" ")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function StatGrid({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="grid grid-cols-3 divide-x divide-border/60 rounded border border-border/60 bg-surface-base/40">
      {items.map((item) => (
        <div key={item.label} className="px-2 py-2 text-center">
          <p className="text-[9px] uppercase tracking-wide text-text-muted">{item.label}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-text-primary">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
