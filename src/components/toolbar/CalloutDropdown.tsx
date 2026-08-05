import { useState, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  StickyNote,
  ChevronDown,
  Lightbulb,
  Info,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  HelpCircle,
  Star,
  AlertCircle,
  XCircle,
  Bug,
  BookOpen,
  Quote,
  type LucideIcon,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { insertCallout } from "../toolbarActions";

interface CalloutType {
  type: string;
  Icon: LucideIcon;
  color: string;
}

const ICON_SIZE_NORMAL = 14;

const CALLOUT_TYPES: CalloutType[] = [
  { type: "TIP", Icon: Lightbulb, color: "#4ade80" },
  { type: "INFO", Icon: Info, color: "#60a5fa" },
  { type: "NOTE", Icon: StickyNote, color: "#c084fc" },
  { type: "WARNING", Icon: AlertTriangle, color: "#facc15" },
  { type: "DANGER", Icon: AlertOctagon, color: "#f87171" },
  { type: "SUCCESS", Icon: CheckCircle2, color: "#4ade80" },
  { type: "QUESTION", Icon: HelpCircle, color: "#22d3ee" },
  { type: "IMPORTANT", Icon: Star, color: "#fb923c" },
  { type: "CAUTION", Icon: AlertCircle, color: "#fbbf24" },
  { type: "FAILURE", Icon: XCircle, color: "#f87171" },
  { type: "BUG", Icon: Bug, color: "#ef4444" },
  { type: "EXAMPLE", Icon: BookOpen, color: "#818cf8" },
  { type: "QUOTE", Icon: Quote, color: "#94a3b8" },
];

export default function CalloutDropdown({
  viewRef,
  iconSize,
  btnCls,
}: {
  viewRef: RefObject<EditorView | null>;
  iconSize: number;
  btnCls: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        title="Insert callout block"
        onMouseDown={toggle}
        className={`${btnCls} flex items-center gap-0.5`}
      >
        <StickyNote size={iconSize} />
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
              className="fixed z-[999] w-44 rounded-lg border border-border bg-surface-raised p-1.5 shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                Callout type
              </p>
              <div className="grid grid-cols-2 gap-0.5">
                {CALLOUT_TYPES.map(({ type, Icon, color }) => (
                  <button
                    key={type}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const view = viewRef.current;
                      if (view) insertCallout(view, type);
                      setOpen(false);
                    }}
                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-surface-overlay"
                    style={{ color }}
                  >
                    <Icon size={ICON_SIZE_NORMAL} />
                    <span className="capitalize leading-none">
                      {type.charAt(0) + type.slice(1).toLowerCase()}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
