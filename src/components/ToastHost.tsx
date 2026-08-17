import { X } from "lucide-react";
import { useToastStore } from "@/store/useToastStore";

export default function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const confirm = useToastStore((s) => s.confirm);
  const removeToast = useToastStore((s) => s.removeToast);
  const resolveConfirm = useToastStore((s) => s.resolveConfirm);

  return (
    <>
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[6000] flex max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              "pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm",
              t.variant === "success"
                ? "border-green-500/30 bg-green-500/15 text-green-200"
                : t.variant === "error"
                  ? "border-red-500/30 bg-red-500/15 text-red-200"
                  : "border-border bg-surface-raised/95 text-text-primary",
            ].join(" ")}
          >
            <span className="min-w-0 flex-1 leading-relaxed">{t.message}</span>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {confirm && (
        <div className="fixed inset-0 z-[6100] flex items-center justify-center bg-black/55 p-4">
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface-raised p-4 shadow-2xl"
            role="alertdialog"
            aria-labelledby="confirm-title"
            aria-describedby="confirm-message"
          >
            <h2 id="confirm-title" className="text-sm font-semibold text-text-primary">
              {confirm.title}
            </h2>
            <p
              id="confirm-message"
              className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary"
            >
              {confirm.message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-overlay"
              >
                {confirm.cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => resolveConfirm(true)}
                className={[
                  "rounded-md px-3 py-1.5 text-xs font-medium",
                  confirm.danger
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "bg-accent text-on-accent hover:bg-accent-hover",
                ].join(" ")}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
