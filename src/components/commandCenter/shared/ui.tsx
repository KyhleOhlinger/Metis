import type { ReactNode } from "react";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
      {children}
    </span>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{title}</p>
      <div className="rounded-md border border-border bg-surface-overlay p-2 space-y-1">{children}</div>
    </div>
  );
}

export function KV({ label, value, mono = false, highlight = false }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="shrink-0 text-[10px] text-text-muted">{label}</span>
      <span
        className={["truncate text-right text-[11px]", mono ? "font-mono" : "", highlight ? "text-accent" : "text-text-secondary"].join(" ")}
        title={value}
      >
        {value}
      </span>
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
