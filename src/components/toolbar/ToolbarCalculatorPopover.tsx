import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { Calculator, ChevronDown } from "lucide-react";
import type { EditorView } from "@codemirror/view";

type Op = "+" | "-" | "×" | "÷";

function applyOp(a: number, b: number, op: Op): number | null {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "×":
      return a * b;
    case "÷":
      return b === 0 ? null : a / b;
    default:
      return null;
  }
}

function formatResult(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

interface Props {
  viewRef: RefObject<EditorView | null>;
  iconSize: number;
  btnCls: string;
}

export default function ToolbarCalculatorPopover({ viewRef, iconSize, btnCls }: Props) {
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 220) });
    }
    setOpen((v) => !v);
  };

  const close = () => setOpen(false);

  const reset = useCallback(() => {
    setDisplay("0");
    setStored(null);
    setPendingOp(null);
    setFresh(true);
  }, []);

  const inputDigit = (digit: string) => {
    setDisplay((cur) => {
      if (fresh || cur === "0") {
        setFresh(false);
        return digit === "." ? "0." : digit;
      }
      if (digit === "." && cur.includes(".")) return cur;
      return cur + digit;
    });
  };

  const inputOp = (op: Op) => {
    const value = Number(display);
    if (stored !== null && pendingOp && !fresh) {
      const result = applyOp(stored, value, pendingOp);
      if (result === null) {
        setDisplay("Error");
        setStored(null);
        setPendingOp(null);
        setFresh(true);
        return;
      }
      setStored(result);
      setDisplay(formatResult(result));
    } else {
      setStored(value);
    }
    setPendingOp(op);
    setFresh(true);
  };

  const equals = () => {
    if (stored === null || !pendingOp) return;
    const value = Number(display);
    const result = applyOp(stored, value, pendingOp);
    if (result === null) {
      setDisplay("Error");
      setStored(null);
      setPendingOp(null);
      setFresh(true);
      return;
    }
    setDisplay(formatResult(result));
    setStored(null);
    setPendingOp(null);
    setFresh(true);
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(display);
    } catch {
      /* clipboard unavailable */
    }
  };

  const insertAtCursor = () => {
    const view = viewRef.current;
    if (!view || display === "Error") return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: display },
      selection: { anchor: from + display.length },
    });
    view.focus();
    close();
  };

  const keys: Array<{ label: string; action: () => void; wide?: boolean; accent?: boolean }> = [
    { label: "C", action: reset, accent: true },
    { label: "⌫", action: () => setDisplay((d) => (d.length <= 1 || d === "Error" ? "0" : d.slice(0, -1))) },
    { label: "÷", action: () => inputOp("÷"), accent: true },
    { label: "×", action: () => inputOp("×"), accent: true },
    { label: "7", action: () => inputDigit("7") },
    { label: "8", action: () => inputDigit("8") },
    { label: "9", action: () => inputDigit("9") },
    { label: "-", action: () => inputOp("-"), accent: true },
    { label: "4", action: () => inputDigit("4") },
    { label: "5", action: () => inputDigit("5") },
    { label: "6", action: () => inputDigit("6") },
    { label: "+", action: () => inputOp("+"), accent: true },
    { label: "1", action: () => inputDigit("1") },
    { label: "2", action: () => inputDigit("2") },
    { label: "3", action: () => inputDigit("3") },
    { label: "+", action: () => inputOp("+"), accent: true },
    { label: "0", action: () => inputDigit("0"), wide: true },
    { label: ".", action: () => inputDigit(".") },
    { label: "=", action: equals, accent: true },
  ];

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        title="Calculator"
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
            <div className="fixed inset-0 z-[998]" onMouseDown={close} />
            <div
              className="fixed z-[999] w-[220px] rounded-lg border border-border bg-surface-raised p-2 shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="mb-2 rounded border border-border bg-surface-base px-2 py-1.5 text-right font-mono text-sm text-text-primary">
                {display}
              </div>
              <div className="grid grid-cols-4 gap-1">
                {keys.map((key) => (
                  <button
                    key={key.label}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      key.action();
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
              <div className="mt-2 flex gap-1 border-t border-border pt-2">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void copyResult();
                  }}
                  className="flex-1 rounded border border-border bg-surface-overlay py-1 text-[10px] text-text-secondary hover:text-text-primary"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertAtCursor();
                  }}
                  className="flex-1 rounded border border-accent/30 bg-accent/15 py-1 text-[10px] font-medium text-accent hover:bg-accent/25"
                >
                  Insert
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
