import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Calculator, ChevronDown } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { copyTextToClipboard } from "@/utils/clipboard";
import {
  evaluateExpression,
  looksLikeCalcExpression,
  negateLastNumber,
} from "@/utils/calculatorExpr";

const POPOVER_W = 268;
const HISTORY_MAX = 8;

type PadKey = {
  id: string;
  label: string;
  insert?: string;
  action?: "clear" | "back" | "neg" | "eq";
  wide?: boolean;
  accent?: boolean;
};

const PAD: PadKey[] = [
  { id: "c", label: "C", action: "clear", accent: true },
  { id: "bk", label: "⌫", action: "back" },
  { id: "lp", label: "(", insert: "(" },
  { id: "rp", label: ")", insert: ")" },
  { id: "7", label: "7", insert: "7" },
  { id: "8", label: "8", insert: "8" },
  { id: "9", label: "9", insert: "9" },
  { id: "div", label: "÷", insert: "÷", accent: true },
  { id: "4", label: "4", insert: "4" },
  { id: "5", label: "5", insert: "5" },
  { id: "6", label: "6", insert: "6" },
  { id: "mul", label: "×", insert: "×", accent: true },
  { id: "1", label: "1", insert: "1" },
  { id: "2", label: "2", insert: "2" },
  { id: "3", label: "3", insert: "3" },
  { id: "sub", label: "−", insert: "−", accent: true },
  { id: "neg", label: "±", action: "neg" },
  { id: "0", label: "0", insert: "0" },
  { id: "dot", label: ".", insert: "." },
  { id: "add", label: "+", insert: "+", accent: true },
  { id: "pct", label: "%", insert: "%" },
  { id: "pow", label: "^", insert: "^" },
  { id: "eq", label: "=", action: "eq", wide: true, accent: true },
];

interface HistoryItem {
  expr: string;
  result: string;
}

interface Props {
  viewRef: RefObject<EditorView | null>;
  iconSize: number;
  btnCls: string;
}

function seedFromEditor(view: EditorView | null): string {
  if (!view) return "";
  const sel = view.state.selection.main;
  if (sel.empty) return "";
  const text = view.state.sliceDoc(sel.from, sel.to).trim();
  if (!text || !looksLikeCalcExpression(text)) return "";
  return text;
}

function clampPos(top: number, left: number): { top: number; left: number } {
  const maxLeft = Math.max(8, window.innerWidth - POPOVER_W - 8);
  const maxTop = Math.max(8, window.innerHeight - 420);
  return {
    top: Math.min(Math.max(8, top), maxTop),
    left: Math.min(Math.max(8, left), maxLeft),
  };
}

export default function ToolbarCalculatorPopover({ viewRef, iconSize, btnCls }: Props) {
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const evaluated = useMemo(() => evaluateExpression(expr), [expr]);
  const resultText = evaluated.ok ? evaluated.formatted : "";
  const errorText = !evaluated.ok && evaluated.error ? evaluated.error : "";

  const focusInput = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pushHistory = useCallback((expression: string, result: string) => {
    setHistory((prev) => {
      const next = [{ expr: expression, result }, ...prev.filter((h) => h.expr !== expression)];
      return next.slice(0, HISTORY_MAX);
    });
  }, []);

  const commitEquals = useCallback(() => {
    const ev = evaluateExpression(expr);
    if (!ev.ok) return;
    pushHistory(expr, ev.formatted);
    setExpr(ev.formatted);
  }, [expr, pushHistory]);

  const insertText = useCallback(
    (text: string) => {
      const view = viewRef.current;
      if (!view || !text) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
      setOpen(false);
    },
    [viewRef],
  );

  const insertResult = useCallback(() => {
    if (!evaluated.ok) return;
    pushHistory(expr, evaluated.formatted);
    insertText(evaluated.formatted);
  }, [evaluated, expr, insertText, pushHistory]);

  const insertEquation = useCallback(() => {
    if (!evaluated.ok || !expr.trim()) return;
    pushHistory(expr, evaluated.formatted);
    insertText(`${expr.trim()} = ${evaluated.formatted}`);
  }, [evaluated, expr, insertText, pushHistory]);

  const copyResult = async () => {
    if (!evaluated.ok) return;
    await copyTextToClipboard(evaluated.formatted, { successMessage: "Copied." });
  };

  const applyPad = (key: PadKey) => {
    if (key.action === "clear") {
      setExpr("");
      return;
    }
    if (key.action === "back") {
      setExpr((cur) => cur.slice(0, -1));
      return;
    }
    if (key.action === "neg") {
      setExpr((cur) => negateLastNumber(cur));
      return;
    }
    if (key.action === "eq") {
      commitEquals();
      return;
    }
    if (key.insert) setExpr((cur) => cur + key.insert);
  };

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos(clampPos(r.bottom + 4, r.right - POPOVER_W));
      setExpr(seedFromEditor(viewRef.current));
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (open) focusInput();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title="Calculator — evaluate in the popover; copy or insert only when you choose"
        onMouseDown={toggle}
        className={`${btnCls} flex items-center gap-0.5`}
      >
        <Calculator size={iconSize} />
        <ChevronDown
          size={Math.max(7, iconSize - 5)}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[998]" onMouseDown={() => setOpen(false)} />
            <div
              className="fixed z-[999] rounded-lg border border-border bg-surface-raised p-2 shadow-xl"
              style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <label className="sr-only" htmlFor="metis-calc-expr">
                Calculator expression
              </label>
              <input
                id="metis-calc-expr"
                ref={inputRef}
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEquals();
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder="2 + 3 × 4"
                className="w-full rounded border border-border bg-surface-base px-2 py-1.5 font-mono text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
              />
              <div className="mt-1 min-h-[1.25rem] px-0.5 text-right font-mono text-xs">
                {evaluated.ok ? (
                  <span className="text-accent">= {resultText}</span>
                ) : errorText ? (
                  <span className="text-red-400">{errorText}</span>
                ) : (
                  <span className="text-text-muted">=</span>
                )}
              </div>

              <div className="mt-1.5 grid grid-cols-4 gap-1">
                {PAD.map((key) => (
                  <button
                    key={key.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyPad(key);
                      focusInput();
                    }}
                    className={[
                      "rounded py-1.5 text-xs font-medium transition-colors",
                      key.wide ? "col-span-2" : "",
                      key.accent
                        ? "bg-accent/15 text-accent hover:bg-accent/25"
                        : "bg-surface-overlay text-text-primary hover:bg-surface-base",
                    ].join(" ")}
                  >
                    {key.label}
                  </button>
                ))}
              </div>

              {history.length > 0 && (
                <div className="mt-2 max-h-16 space-y-0.5 overflow-y-auto border-t border-border pt-1.5">
                  {history.map((item) => (
                    <button
                      key={`${item.expr}=${item.result}`}
                      type="button"
                      title="Reuse this expression"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setExpr(item.expr);
                        focusInput();
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left font-mono text-[10px] text-text-muted hover:bg-surface-overlay hover:text-text-primary"
                    >
                      <span className="min-w-0 truncate">{item.expr}</span>
                      <span className="shrink-0 text-accent">{item.result}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-2 flex gap-1 border-t border-border pt-2">
                <button
                  type="button"
                  disabled={!evaluated.ok}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void copyResult();
                  }}
                  className="flex-1 rounded border border-border bg-surface-overlay py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Copy
                </button>
                <button
                  type="button"
                  disabled={!evaluated.ok}
                  title="Insert expression = result into the note"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertEquation();
                  }}
                  className="flex-1 rounded border border-border bg-surface-overlay py-1 text-[10px] text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Insert eq
                </button>
                <button
                  type="button"
                  disabled={!evaluated.ok}
                  title="Insert the result into the note"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertResult();
                  }}
                  className="flex-1 rounded border border-accent/30 bg-accent/15 py-1 text-[10px] font-medium text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Insert
                </button>
              </div>
              <p className="mt-1.5 text-[9px] leading-snug text-text-muted">
                Enter or = evaluates here. Copy or Insert only writes to the note.
              </p>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
