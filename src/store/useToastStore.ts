import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

type DialogChoice = "confirm" | "cancel" | "extra";

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  extraLabel?: string;
  danger: boolean;
  resolve: (value: DialogChoice) => void;
}

interface ToastState {
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  pushToast: (message: string, variant?: ToastVariant, durationMs?: number) => void;
  removeToast: (id: string) => void;
  confirmDialog: (options: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  chooseDialog: (options: {
    title?: string;
    message: string;
    confirmLabel: string;
    extraLabel: string;
    cancelLabel: string;
  }) => Promise<"confirm" | "extra" | "cancel">;
  resolveConfirm: (value: "confirm" | "cancel" | "extra") => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  confirm: null,

  pushToast: (message, variant = "info", durationMs = 4200) => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }));
    window.setTimeout(() => get().removeToast(id), durationMs);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  confirmDialog: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        confirm: {
          title: options.title ?? "Confirm",
          message: options.message,
          confirmLabel: options.confirmLabel ?? "Confirm",
          cancelLabel: options.cancelLabel ?? "Cancel",
          danger: options.danger ?? false,
          resolve: (value) => resolve(value === "confirm"),
        },
      });
    }),

  chooseDialog: (options) =>
    new Promise((resolve) => {
      set({
        confirm: {
          title: options.title ?? "Choose",
          message: options.message,
          confirmLabel: options.confirmLabel,
          extraLabel: options.extraLabel,
          cancelLabel: options.cancelLabel,
          danger: false,
          resolve,
        },
      });
    }),

  resolveConfirm: (value) => {
    const pending = get().confirm;
    if (pending) pending.resolve(value);
    set({ confirm: null });
  },
}));

export function toastSuccess(message: string) {
  useToastStore.getState().pushToast(message, "success");
}

export function toastError(message: string) {
  useToastStore.getState().pushToast(message, "error", 6000);
}

export function toastInfo(message: string) {
  useToastStore.getState().pushToast(message, "info");
}

export async function appConfirm(
  message: string,
  options?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  },
): Promise<boolean> {
  return useToastStore.getState().confirmDialog({ message, ...options });
}

export async function appChoose(
  message: string,
  options: { title?: string; confirmLabel: string; extraLabel: string; cancelLabel: string },
): Promise<"confirm" | "extra" | "cancel"> {
  return useToastStore.getState().chooseDialog({ message, ...options });
}
