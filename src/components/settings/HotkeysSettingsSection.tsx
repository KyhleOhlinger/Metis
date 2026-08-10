import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/types/persona";
import {
  KEYBINDING_BY_ID,
  KEYBINDING_CATEGORIES,
  KEYBINDING_MOUSE_HINTS,
  KEYBINDING_REGISTRY,
  type KeybindingCommandId,
} from "@/config/keybindingRegistry";
import {
  findConflicts,
  getDisplayChord,
} from "@/services/keybindingRuntime";
import { chordFromKeyboardEvent, type KeyChord } from "@/utils/keyChord";

const labelCls = "text-[10px] font-semibold uppercase tracking-widest text-text-muted";

interface Props {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}

export function HotkeysSettingsSection({ settings, onUpdate }: Props) {
  const [recordingId, setRecordingId] = useState<KeybindingCommandId | null>(null);
  const recordingRef = useRef(recordingId);
  recordingRef.current = recordingId;

  const finishRecording = useCallback(
    (id: KeybindingCommandId, chord: KeyChord | null) => {
      const overrides = { ...settings.keybindingOverrides };
      if (chord === null) {
        overrides[id] = null;
      } else {
        overrides[id] = chord;
      }
      onUpdate({ keybindingOverrides: overrides });
      setRecordingId(null);
    },
    [settings.keybindingOverrides, onUpdate],
  );

  useEffect(() => {
    if (!recordingId) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const id = recordingRef.current;
      if (!id) return;

      if (e.key === "Escape") {
        setRecordingId(null);
        return;
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        finishRecording(id, null);
        return;
      }

      const chord = chordFromKeyboardEvent(e);
      if (!chord) return;

      finishRecording(id, chord);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId, finishRecording]);

  const resetBinding = (id: KeybindingCommandId) => {
    const overrides = { ...settings.keybindingOverrides };
    delete overrides[id];
    onUpdate({ keybindingOverrides: overrides });
  };

  return (
    <div className="space-y-4 text-[11px]">
      <p className="text-text-muted">
        Click a shortcut to rebind it. Changes apply in the app and sync to the native menu bar
        (File, View, Settings…). Press{" "}
        <kbd className="rounded border border-border px-1 font-mono text-[10px]">Esc</kbd> to cancel, or{" "}
        <kbd className="rounded border border-border px-1 font-mono text-[10px]">Backspace</kbd> while recording
        to disable.
      </p>

      {KEYBINDING_CATEGORIES.map((cat) => {
        const rows = KEYBINDING_REGISTRY.filter((d) => d.rebindable && d.category === cat);
        if (!rows.length) return null;
        return (
          <div key={cat}>
            <p className={labelCls}>{cat}</p>
            <div className="mt-1.5 overflow-hidden rounded-md border border-border">
              {rows.map((row, i) => {
                const recording = recordingId === row.id;
                const display = recording ? "Press shortcut…" : getDisplayChord(row.id, settings);
                const override = settings.keybindingOverrides?.[row.id];
                const isCustom = override !== undefined;
                const conflicts =
                  override && override !== null
                    ? findConflicts(row.id, override, settings)
                    : [];

                return (
                  <div
                    key={row.id}
                    className={[
                      "flex items-center justify-between gap-3 px-2.5 py-1.5",
                      i > 0 ? "border-t border-border/60" : "",
                      recording ? "bg-accent/10" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <span className="text-text-primary">{row.label}</span>
                      {conflicts.length > 0 && (
                        <p className="mt-0.5 text-[10px] text-amber-500/90">
                          Conflicts with {conflicts.map((c) => KEYBINDING_BY_ID[c].label).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isCustom && !recording && (
                        <button
                          type="button"
                          onClick={() => resetBinding(row.id)}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-secondary"
                        >
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRecordingId(row.id)}
                        className={[
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                          recording
                            ? "border-accent bg-accent/15 text-text-primary"
                            : "border-border bg-surface-base text-text-muted hover:border-accent/50 hover:text-text-secondary",
                        ].join(" ")}
                      >
                        {display}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {KEYBINDING_MOUSE_HINTS.length > 0 && (
        <div>
          <p className={labelCls}>Mouse</p>
          <div className="mt-1.5 overflow-hidden rounded-md border border-border">
            {KEYBINDING_MOUSE_HINTS.map((row, i) => (
              <div
                key={row.id}
                className={[
                  "flex items-center justify-between gap-3 px-2.5 py-1.5",
                  i > 0 ? "border-t border-border/60" : "",
                ].join(" ")}
              >
                <span className="text-text-primary">{row.label}</span>
                <kbd className="shrink-0 rounded border border-border bg-surface-base px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                  {row.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
