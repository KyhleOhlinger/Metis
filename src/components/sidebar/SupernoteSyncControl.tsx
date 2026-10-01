import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import { usePersonaStore } from "@/store/usePersonaStore";
import { runSupernoteSync } from "@/services/supernoteSync";
import { SUPERNOTE_DEFAULT_PORT } from "@/constants/supernote";

const POPOVER_W = 224;

function clampPos(top: number, left: number): { top: number; left: number } {
  const maxLeft = Math.max(8, window.innerWidth - POPOVER_W - 8);
  const maxTop = Math.max(8, window.innerHeight - 220);
  return {
    top: Math.min(Math.max(8, top), maxTop),
    left: Math.min(Math.max(8, left), maxLeft),
  };
}

export function SupernoteSyncControl() {
  const ip = usePersonaStore((s) => s.settings.supernoteDeviceIp ?? "");
  const updateSettings = usePersonaStore((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(ip);
  const [syncing, setSyncing] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(ip);
  }, [ip]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const saveIp = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.includes(":")) return;
    updateSettings({ supernoteDeviceIp: trimmed });
  };

  const sync = async () => {
    saveIp(draft);
    setSyncing(true);
    try {
      await runSupernoteSync();
    } finally {
      setSyncing(false);
    }
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos(clampPos(rect.bottom + 4, rect.left));
    }
    setOpen(true);
  };

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        title="Supernote: set Nomad IP or sync via Browse & Access"
        onClick={toggle}
        className="rounded p-0.5 text-text-muted hover:text-text-primary"
      >
        <RefreshCw size={11} className={syncing ? "animate-spin" : undefined} />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[999] w-56 rounded-md border border-border bg-surface-raised p-2 shadow-xl"
            style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted">
              Nomad IP
            </p>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => saveIp(draft)}
              placeholder="192.168.1.12"
              className="w-full rounded border border-border bg-surface-base px-1.5 py-1 font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-[9px] leading-snug text-text-muted">
              No port (uses {SUPERNOTE_DEFAULT_PORT}). Enable Browse & Access on the Nomad first.
            </p>
            <button
              type="button"
              disabled={syncing}
              onClick={() => void sync()}
              className="mt-1.5 w-full rounded border border-accent/40 bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/25 disabled:opacity-40"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
