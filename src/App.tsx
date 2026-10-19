import { useEffect, useCallback, useState, useRef, Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import CommandCenter from "./components/commandCenter";
import SettingsModal from "./components/settings/SettingsModal";
import CommandPalette from "./components/CommandPalette";
import ConvertVaultModal from "./components/ConvertVaultModal";
import ExportPdfModal from "./components/ExportPdfModal";
import ExportHubModal from "./components/ExportHubModal";
import ConvertToJekyllModal from "./components/ConvertToJekyllModal";
import ToastHost from "./components/ToastHost";
import { SourceUpdateBanner } from "./components/SourceUpdateBanner";
import { useStore, VaultData } from "./store/useStore";
import { useMenuEvents } from "./hooks/useMenuEvents";
import { openOrCreateDailyNote } from "./components/sidebar/dailyNote";
import { useGlobalKeybindings } from "./hooks/useGlobalKeybindings";
import { LAST_VAULT_KEY } from "./constants";
import {
  flushPlannerSaves,
} from "./planner/plannerPersistence";
import { toastError } from "./store/useToastStore";
import { useSourceUpdateSchedule } from "./hooks/useSourceUpdateSchedule";
import { useSupernoteSyncSchedule } from "./hooks/useSupernoteSyncSchedule";
import { useBackupSyncSchedule } from "./hooks/useBackupSyncSchedule";
import { formatError } from "./utils/formatError";
import { CommunityPluginStyles } from "./plugins/CommunityPluginStyles";
import { isCorePluginEnabled } from "./plugins/usePluginStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { editorPaneThemeVars, applyAppThemeToDocument } from "./components/editor/bgPresets";
import { useAppTheme } from "./hooks/useAppTheme";

// ── Error Boundary ─────────────────────────────────────────────────────────────
// Catches any React render errors and shows a human-readable message instead of
// a completely blank/black screen. Without this, an unhandled render error
// silently unmounts the entire component tree.
class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Metis] Render error caught by boundary:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="editor-theme flex h-screen w-screen flex-col items-center justify-center gap-4 bg-surface-base p-8 text-center text-text-primary">
          <p className="text-sm font-semibold text-red-400">Something went wrong</p>
          <pre className="max-w-xl overflow-auto rounded-md bg-surface-overlay px-4 py-3 text-left font-mono text-xs text-text-secondary">
            {this.state.error.message}
          </pre>
          <button
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
            onClick={() => this.setState({ error: null })}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 3-pane layout:
 *  ┌──────────┬─────────────────────────────┬──────────────┐
 *  │  Files   │          Editor             │   Command    │
 *  │ (240 px) │       (flex-grow)           │   Center     │
 *  │          │                             │  (240 px)    │
 *  └──────────┴─────────────────────────────┴──────────────┘
 */
// ── Resizable pane constants ──────────────────────────────────────────────────
const SIDEBAR_MIN  = 140;   // px — reduced so narrow windows still work
const SIDEBAR_MAX  = 520;
const CC_MIN       = 180;   // px — reduced so narrow windows still work
const CC_MAX       = 640;
const COLLAPSED_W  = 32;    // w-8, strip width when panel is closed
const EDITOR_MIN   = 260;   // px — minimum usable editor width

/** Proportional default: 18% of viewport, clamped to [SIDEBAR_MIN, 240]. */
function initSidebarWidth() {
  return Math.round(Math.min(240, Math.max(SIDEBAR_MIN, window.innerWidth * 0.18)));
}
/** Proportional default: 24% of viewport, clamped to [CC_MIN, 320]. */
function initCcWidth() {
  return Math.round(Math.min(320, Math.max(CC_MIN, window.innerWidth * 0.24)));
}

export default function App() {
  const vaultPath    = useStore((s) => s.vaultPath);
  const isMetisVault = useStore((s) => s.isMetisVault);
  const refreshVault = useStore((s) => s.refreshVault);
  const [vaultRestoring, setVaultRestoring] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportPdfOpen, setExportPdfOpen] = useState(false);
  const [exportHubOpen, setExportHubOpen] = useState(false);
  const [jekyllExportPath, setJekyllExportPath] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ccOpen, setCcOpen] = useState(true);

  // Tracks a pending vault-conversion prompt (path + hint) shown when the user
  // opens a folder that lacks a .metis/vault.json marker.
  const [convertPrompt, setConvertPrompt] = useState<{
    path: string;
    hint?: string;
  } | null>(null);

  // Widths initialised proportionally so they adapt to the launch window size
  const [sidebarWidth, setSidebarWidth] = useState(initSidebarWidth);
  const [ccWidth, setCcWidth]           = useState(initCcWidth);

  const bgPreset = useAppTheme();

  useEffect(() => {
    applyAppThemeToDocument(bgPreset);
  }, [bgPreset]);

  // ── Live refs ─────────────────────────────────────────────────────────────
  // Kept in sync below so resize / drag handlers always see the current values
  // without needing to re-create callbacks on every render.
  const sidebarWidthRef = useRef(sidebarWidth);
  const ccWidthRef      = useRef(ccWidth);
  const sidebarOpenRef  = useRef(sidebarOpen);
  const ccOpenRef       = useRef(ccOpen);

  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);
  useEffect(() => { ccWidthRef.current      = ccWidth;      }, [ccWidth]);
  useEffect(() => { sidebarOpenRef.current  = sidebarOpen;  }, [sidebarOpen]);
  useEffect(() => { ccOpenRef.current       = ccOpen;       }, [ccOpen]);

  // ── Window resize → clamp panel widths ───────────────────────────────────
  // Runs once (uses refs for live state) so it never becomes stale.
  // Auto-collapses panels when the window is too narrow to host them.
  useEffect(() => {
    function handleResize() {
      const vw  = window.innerWidth;
      const so  = sidebarOpenRef.current;
      const co  = ccOpenRef.current;
      const sw  = sidebarWidthRef.current;
      const cw  = ccWidthRef.current;

      // If even the minimum panel sizes leave no room for the editor,
      // collapse the right panel first, then the left.
      const minNeeded =
        (so ? SIDEBAR_MIN : COLLAPSED_W) + EDITOR_MIN + (co ? CC_MIN : COLLAPSED_W);
      if (minNeeded > vw) {
        if (co)  { setCcOpen(false);      return; }
        if (so)  { setSidebarOpen(false); return; }
      }

      // Otherwise clamp widths so the editor always keeps EDITOR_MIN pixels
      if (so) {
        const ccUsed  = co ? cw : COLLAPSED_W;
        const maxSide = Math.max(SIDEBAR_MIN, vw - EDITOR_MIN - ccUsed);
        if (sw > maxSide) setSidebarWidth(maxSide);
      }
      if (co) {
        const sideUsed = so ? sw : COLLAPSED_W;
        const maxCc    = Math.max(CC_MIN, vw - EDITOR_MIN - sideUsed);
        if (cw > maxCc) setCcWidth(maxCc);
      }
    }

    window.addEventListener("resize", handleResize);
    handleResize(); // also clamp on initial mount
    return () => window.removeEventListener("resize", handleResize);
  }, []); // intentionally empty — all live state accessed via refs

  // ── Drag handles ─────────────────────────────────────────────────────────
  // Ref holds transient drag state — avoids re-renders on every pointermove
  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);

  // Enforce EDITOR_MIN during drag so panels can never crowd out the editor
  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = e.clientX - d.startX;
    const vw    = window.innerWidth;
    if (d.side === "left") {
      const ccUsed  = ccOpenRef.current ? ccWidthRef.current : COLLAPSED_W;
      const maxSide = Math.min(SIDEBAR_MAX, vw - EDITOR_MIN - ccUsed);
      setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(maxSide, d.startWidth + delta)));
    } else {
      const sideUsed = sidebarOpenRef.current ? sidebarWidthRef.current : COLLAPSED_W;
      const maxCc    = Math.min(CC_MAX, vw - EDITOR_MIN - sideUsed);
      setCcWidth(Math.max(CC_MIN, Math.min(maxCc, d.startWidth - delta)));
    }
  }, []);

  const onHandlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // When a new window is spawned for a specific vault, main.rs encodes the
  // vault path as a `?vault=` query parameter so we can open it immediately
  // without touching the shared localStorage "last vault" key.
  const vaultFromUrl = new URLSearchParams(window.location.search).get("vault");

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const togglePanel   = useCallback(() => setCcOpen((v) => !v), []);
  const lastPaneRef = useRef<"sidebar" | "editor" | "cc">("editor");

  const openDailyNote = useCallback(() => {
    const { vaultPath: vp, refreshVault: rv } = useStore.getState();
    if (!vp) return;
    void openOrCreateDailyNote(vp, rv);
  }, []);

  const onForeignVault = useCallback((path: string, hint?: string) => {
    setConvertPrompt({ path, hint });
  }, []);

  const openExportPdf = useCallback(() => setExportPdfOpen(true), []);
  useMenuEvents({ toggleSidebar, togglePanel, openDailyNote, onExportPdf: openExportPdf, onForeignVault });

  useGlobalKeybindings({
    setPaletteOpen,
    sidebarOpen,
    setSidebarOpen,
    lastPaneRef,
    toggleSidebar,
    togglePanel,
    openDailyNote,
  });

  const pendingMenuAction = useStore((s) => s.pendingMenuAction);
  const setPendingMenuAction = useStore((s) => s.setPendingMenuAction);

  useEffect(() => {
    if (!pendingMenuAction) return;
    switch (pendingMenuAction) {
      case "open-palette":
        setPaletteOpen(true);
        break;
      case "export-hub":
        if (isCorePluginEnabled("export")) setExportHubOpen(true);
        break;
      case "new-note":
      case "new-folder":
        setSidebarOpen(true);
        return;
      case "daily-note":
        if (isCorePluginEnabled("daily-notes")) {
          setSidebarOpen(true);
          openDailyNote();
        }
        break;
      case "open-search":
        if (isCorePluginEnabled("search")) {
          setSidebarOpen(true);
          useStore.getState().setSidebarView("search");
        }
        break;
      default:
        return;
    }
    setPendingMenuAction(null);
  }, [pendingMenuAction, setPendingMenuAction, openDailyNote]);

  // Vault restoration — runs whenever vaultPath is null (initial load or HMR).
  //
  // Priority order:
  //  1. ?vault= query param → this window was spawned for a specific vault
  //     (multi-window feature).  Open that vault and skip localStorage.
  //  2. localStorage "last vault" → standard single-window restore on launch.
  useEffect(() => {
    if (vaultPath) return; // vault already open — nothing to restore

    const pathToOpen = vaultFromUrl ?? localStorage.getItem(LAST_VAULT_KEY);
    if (!pathToOpen) return;

    setVaultRestoring(true);
    invoke<VaultData>("open_vault", { path: pathToOpen })
      .then((data) => {
        useStore.getState().setVault(data);
        if (!data.is_metis_vault) {
          setConvertPrompt({ path: data.path, hint: data.vault_hint });
        }
      })
      .catch((err) => {
        toastError(`Could not open vault: ${formatError(err)}`);
        if (!vaultFromUrl) localStorage.removeItem(LAST_VAULT_KEY);
      })
      .finally(() => setVaultRestoring(false));
  }, [vaultPath, vaultFromUrl]);

  // If the vault becomes a Metis vault after conversion, close the prompt.
  useEffect(() => {
    if (isMetisVault) setConvertPrompt(null);
  }, [isMetisVault]);

  // Persist the active vault path so the primary window can restore it on
  // next launch.  New windows (URL-specified) don't write to localStorage so
  // they don't clobber the primary window's saved vault.
  useEffect(() => {
    if (vaultPath && !vaultFromUrl) {
      localStorage.setItem(LAST_VAULT_KEY, vaultPath);
    }
  }, [vaultPath, vaultFromUrl]);

  // Start (or replace) the Rust FS watcher whenever the active vault changes
  useEffect(() => {
    if (!vaultPath) return;
    invoke("set_vault_watch", { path: vaultPath }).catch(console.error);
  }, [vaultPath]);

  // Listen for structural FS changes (create/remove/rename) emitted by Rust.
  // Debounce so rapid bursts (e.g. moving a folder with many files) collapse
  // into a single sidebar refresh.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    listen<void>("vault-changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => refreshVault(), 300);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      clearTimeout(timer);
    };
  }, [refreshVault]);

  useSourceUpdateSchedule();
  useSupernoteSyncSchedule();
  useBackupSyncSchedule();

  // Flush pending planner writes before window close.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;

    const flushWithTimeout = (ms: number) =>
      Promise.race([
        flushPlannerSaves(),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
      ]);

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        closing = true;
        try {
          await flushWithTimeout(3000);
        } catch (err) {
          console.error("[planner] flush on close failed", err);
        } finally {
          unlisten?.();
          unlisten = undefined;
          try {
            await getCurrentWindow().destroy();
          } catch (err) {
            console.error("[window] destroy failed, falling back to close", err);
            try {
              await getCurrentWindow().close();
            } catch (closeErr) {
              console.error("[window] close failed", closeErr);
            }
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <AppErrorBoundary>
    <div
      className="editor-theme flex h-screen w-screen flex-col overflow-hidden text-text-primary"
      style={editorPaneThemeVars(bgPreset)}
      data-color-scheme={bgPreset.isDark ? "dark" : "light"}
    >
      <ToastHost />
      <CommunityPluginStyles />
      <SettingsModal />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {exportPdfOpen && vaultPath && (
        <ExportPdfModal onClose={() => setExportPdfOpen(false)} />
      )}
      {exportHubOpen && vaultPath && (
        <ExportHubModal
          onClose={() => setExportHubOpen(false)}
          onJekyllExport={(path) => setJekyllExportPath(path)}
        />
      )}
      {jekyllExportPath && (
        <ConvertToJekyllModal
          notePath={jekyllExportPath}
          onClose={() => setJekyllExportPath(null)}
        />
      )}

      {/* Vault conversion prompt — shown when a non-Metis folder is opened */}
      {convertPrompt && (
        <ConvertVaultModal
          vaultPath={convertPrompt.path}
          vaultHint={convertPrompt.hint}
          onDismiss={() => setConvertPrompt(null)}
        />
      )}

      <SourceUpdateBanner />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* ── Pane 1 — Files sidebar ───────────────────────────── */}
      {/*
       * The resize grip lives INSIDE this container, absolutely pinned to its
       * right edge.  setPointerCapture guarantees all pointermove/up events
       * reach the grip element even after the cursor leaves it — reliable in
       * Tauri's WKWebView without any global listeners.
       */}
      <div
        className="relative shrink-0 overflow-hidden border-r border-border"
        style={{ width: sidebarOpen ? sidebarWidth : COLLAPSED_W }}
        onMouseDown={() => { lastPaneRef.current = "sidebar"; }}
      >
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={toggleSidebar}
          onForeignVault={onForeignVault}
          vaultRestoring={vaultRestoring}
        />

        {/* Inner resize grip — right edge of the sidebar */}
        {sidebarOpen && (
          <div
            className="group absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none select-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { side: "left", startX: e.clientX, startWidth: sidebarWidth };
            }}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
          >
            {/* 1px accent line shown on hover / active drag */}
            <div className="absolute inset-y-0 right-0 w-px bg-transparent group-hover:bg-accent/50 group-active:bg-accent transition-colors duration-100" />
          </div>
        )}
      </div>

      {/* ── Pane 2 — Editor ──────────────────────────────────── */}
      <div className="min-w-0 min-h-0 flex-1" onMouseDown={() => { lastPaneRef.current = "editor"; }}>
        <Editor />
      </div>

      {/* ── Pane 3 — Command Center ───────────────────────────── */}
      {/* Inner resize grip — left edge of the command center */}
      <div
        className="relative shrink-0 overflow-hidden border-l border-border"
        style={{ width: ccOpen ? ccWidth : COLLAPSED_W }}
        onMouseDown={() => { lastPaneRef.current = "cc"; }}
      >
        <CommandCenter isOpen={ccOpen} onToggle={togglePanel} />

        {ccOpen && (
          <div
            className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none select-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { side: "right", startX: e.clientX, startWidth: ccWidth };
            }}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
          >
            <div className="absolute inset-y-0 left-0 w-px bg-transparent group-hover:bg-accent/50 group-active:bg-accent transition-colors duration-100" />
          </div>
        )}
      </div>
      </div>
    </div>
    </AppErrorBoundary>
  );
}
