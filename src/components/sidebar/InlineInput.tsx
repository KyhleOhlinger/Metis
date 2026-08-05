import { useState, useRef, useEffect } from "react";

// ── InlineInput ───────────────────────────────────────────────────────────────

export interface InlineInputProps {
  initialValue?: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  indent?: number;
}

export function InlineInput({ initialValue = "", placeholder, onConfirm, onCancel, indent = 0 }: InlineInputProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    const dotIdx = initialValue.lastIndexOf(".");
    if (dotIdx > 0) ref.current?.setSelectionRange(0, dotIdx);
    else ref.current?.select();
  }, [initialValue]);

  const confirm = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
    else onCancel();
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <div style={{ paddingLeft: `${(indent + 1) * 12}px` }} className="pr-2 py-0.5">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); confirm(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        onBlur={confirm}
        className="w-full rounded border border-accent bg-surface-overlay px-2 py-0.5 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
