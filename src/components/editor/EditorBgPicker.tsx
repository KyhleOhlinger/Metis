import { BG_PRESETS, type BgPreset } from "./bgPresets";

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
  return (
    <div className="relative">
      <button
        type="button"
        title="Change background colour"
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
          <div className="absolute right-0 top-full z-[80] mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised p-2 shadow-xl">
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
          </div>
        </>
      )}
    </div>
  );
}
