import { useEffect, useState, type MouseEvent } from "react";
import {
  BG_PRESETS,
  CUSTOM_PRESET_ID,
  buildCustomBgPreset,
  type BgPreset,
} from "./bgPresets";
import { AppThemeWheelPicker } from "./AppThemeWheelPicker";

export interface EditorBgPickerProps {
  bgPreset: BgPreset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPreset: (preset: BgPreset) => void;
}

export default function EditorBgPicker({
  bgPreset,
  open,
  onOpenChange,
  onSelectPreset,
}: EditorBgPickerProps) {
  const customActive = bgPreset.id === CUSTOM_PRESET_ID;
  const customSwatch = customActive ? bgPreset.bg : "#16171a";
  const [wheelOpen, setWheelOpen] = useState(false);

  useEffect(() => {
    if (!open) setWheelOpen(false);
  }, [open]);

  const applyCustomHex = (raw: string) => {
    const preset = buildCustomBgPreset(raw);
    if (!preset) return;
    onSelectPreset(preset);
  };

  const openWheel = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setWheelOpen(true);
    if (!customActive) {
      applyCustomHex(customSwatch);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        title="App theme"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs text-text-muted transition-colors hover:text-text-primary"
      >
        <span
          className="inline-block h-3 w-3 rounded-full border border-white/20"
          style={{ backgroundColor: bgPreset.bg }}
        />
        <span className="hidden sm:inline">{bgPreset.label}</span>
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => onOpenChange(false)} />
          <div
            className="absolute right-0 top-full z-[80] mt-1 rounded-lg border border-border bg-surface-raised p-2 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              {BG_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.label}
                  onClick={() => {
                    onSelectPreset(p);
                    onOpenChange(false);
                  }}
                  className="flex flex-col items-center gap-1 rounded-md p-1.5 transition-colors hover:bg-surface-overlay"
                >
                  <span
                    className={`h-5 w-5 rounded-full border-2 transition-all ${
                      bgPreset.id === p.id ? "border-accent scale-110" : "border-white/20"
                    }`}
                    style={{ backgroundColor: p.bg }}
                  />
                  <span className="text-[9px] text-text-muted">{p.label}</span>
                </button>
              ))}

              <button
                type="button"
                title="Custom colour wheel"
                onClick={openWheel}
                className={[
                  "flex flex-col items-center gap-1 rounded-md p-1.5 transition-colors hover:bg-surface-overlay cursor-pointer",
                  wheelOpen || customActive ? "bg-surface-overlay" : "",
                ].join(" ")}
              >
                <span
                  className={`relative flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                    customActive || wheelOpen ? "border-accent scale-110" : "border-white/20"
                  }`}
                  style={{
                    background: `conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #3b82f6, #a855f7, #ef4444)`,
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-black/10"
                    style={{ backgroundColor: customSwatch }}
                  />
                </span>
                <span className="text-[9px] text-text-muted">Custom</span>
              </button>
            </div>

            {wheelOpen && (
              <div className="mt-2 border-t border-border pt-2">
                <AppThemeWheelPicker color={customSwatch} onChange={applyCustomHex} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
