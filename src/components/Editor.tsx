import { useEffect, useRef, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import MetadataPanel from "./MetadataPanel";
import SelectionToolbar from "./SelectionToolbar";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import { search } from "@codemirror/search";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { indentUnit } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import { usePersonaStore } from "../store/usePersonaStore";
import {
  metisLineNumbers,
  codeBlockPlugin,
  copyButtonPlugin,
  calloutPlugin,
  markdownAutoComplete,
  wikilinkExtensions,
  markdownLinkCollapseExtension,
  taskListClickExtension,
  listContinuationKeymap,
  smartPasteExtension,
  makeInlinePreviewExtension,
  hideFrontmatterField,
} from "./editorExtensions";
import { lintGutter } from "@codemirror/lint";
import Toolbar, { toggleInline } from "./Toolbar";
import MarkdownPreview from "./MarkdownPreview";
import VaultImageViewer from "./VaultImageViewer";
import EditorFindBar from "./EditorFindBar";
import { spellcheckLinter } from "./spellcheck";
import DailyTaskGrid from "./DailyTaskGrid";
import { isVaultImageFile } from "../utils/vaultImages";
import {
  BG_PRESETS,
  bgCompartment,
  highlightCompartment,
  highlightForPreset,
  makeBgTheme,
  metisTheme,
  plannerThemeVars,
  spellcheckCompartment,
  type BgPreset,
} from "./editor/bgPresets";

function makeSpellcheckExt(enabled: boolean, language: string) {
  return enabled ? [spellcheckLinter(language), lintGutter()] : [];
}

// ── Debounced auto-save (1 s after last keystroke) ────────────────────────────
function useDebouncedSave(
  markSaved: () => void,
  delay = 1000,
) {
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  return useCallback(
    (path: string | null, content: string) => {
      if (!path) return;
      const existing = timers.current.get(path);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        try {
          await invoke("save_note", { path, content });
          // Only clear the dirty state if this saved file is still active.
          if (useStore.getState().activeFilePath === path) {
            markSaved();
          }
        } catch (err) {
          console.error("Auto-save failed:", err);
        } finally {
          timers.current.delete(path);
        }
      }, delay);
      timers.current.set(path, timer);
    },
    [markSaved, delay],
  );
}

function applyEditorNavigation(
  view: EditorView,
  offset: number,
  matchEnd?: number,
): void {
  const docLen = view.state.doc.length;
  const from = Math.max(0, Math.min(offset, docLen));
  const to =
    matchEnd !== undefined
      ? Math.max(from, Math.min(matchEnd, docLen))
      : from;
  const selection =
    to > from ? EditorSelection.range(from, to) : EditorSelection.cursor(from);
  view.dispatch({
    selection,
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
  useStore.getState().setCursorOffset(from);
  view.focus();
}

// ── Editor component ──────────────────────────────────────────────────────────

export default function Editor() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [bgPreset, setBgPreset] = useState<BgPreset>(BG_PRESETS[0]);
  const bgPresetRef = useRef<BgPreset>(BG_PRESETS[0]); // always current — used in editor-creation effect
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [spellcheck, setSpellcheck] = useState(() => localStorage.getItem("metis_spellcheck") === "true");
  const spellcheckRef = useRef(spellcheck);
  const spellcheckLang = usePersonaStore((s) => s.settings.spellcheckLanguage ?? "en_US");
  const spellcheckLangRef = useRef(spellcheckLang);

  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarReplace, setFindBarReplace] = useState(false);
  const findBarRef = useRef<HTMLDivElement>(null);

  const {
    activeFilePath,
    activeFileContent,
    setActiveFileContent,
    markSaved,
    vaultPath,
    noteIndex,
    editorTab: editorMode,
    setEditorTab: setEditorMode,
    editorNavigateTo,
  } = useStore(
    useShallow((s) => ({
      activeFilePath: s.activeFilePath,
      activeFileContent: s.activeFileContent,
      setActiveFileContent: s.setActiveFileContent,
      markSaved: s.markSaved,
      vaultPath: s.vaultPath,
      noteIndex: s.noteIndex,
      editorTab: s.editorTab,
      setEditorTab: s.setEditorTab,
      editorNavigateTo: s.editorNavigateTo,
    })),
  );

  /** Source cursor offset captured when switching to Visual — drives preview scroll. */
  const [visualScrollAnchor, setVisualScrollAnchor] = useState<number | null>(null);
  const prevEditorModeRef = useRef(editorMode);

  const scheduleSave = useDebouncedSave(markSaved);

  const dismissSelectionToolbar = useCallback(() => {
    useStore.getState().clearSelection();
    const view = viewRef.current;
    if (view && !view.state.selection.main.empty) {
      const head = view.state.selection.main.head;
      view.dispatch({ selection: EditorSelection.cursor(head) });
    }
  }, []);

  useEffect(() => {
    dismissSelectionToolbar();
  }, [activeFilePath, editorMode, dismissSelectionToolbar]);

  const activeFileName = activeFilePath?.split("/").pop() ?? "";
  const isImageFile = Boolean(activeFilePath && isVaultImageFile(activeFileName));

  const handlePreviewImageActivate = useCallback(
    (sourceOffset: number) => {
      setEditorMode("source");
      requestAnimationFrame(() => {
        const view = viewRef.current;
        if (!view) return;
        applyEditorNavigation(view, sourceOffset);
      });
    },
    [setEditorMode],
  );

  // ── Apply pending navigation from search results, etc. ─────────────────────
  useEffect(() => {
    if (!editorNavigateTo || editorNavigateTo.path !== activeFilePath || isImageFile) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const tryApply = () => {
      if (cancelled) return;
      const view = viewRef.current;
      if (!view) {
        if (attempts++ < 24) requestAnimationFrame(tryApply);
        return;
      }
      applyEditorNavigation(
        view,
        editorNavigateTo.offset,
        editorNavigateTo.matchEnd,
      );
      useStore.getState().clearEditorNavigateTo();
    };

    tryApply();
    return () => {
      cancelled = true;
    };
  }, [editorNavigateTo, activeFilePath, isImageFile]);

  // ── Create / recreate editor when the active file changes ────────────────────
  useEffect(() => {
    if (!editorHostRef.current) return;

    viewRef.current?.destroy();
    viewRef.current = null;

    if (isVaultImageFile(activeFileName)) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const content = update.state.doc.toString();
        setActiveFileContent(content);
        scheduleSave(activeFilePath, content);
      }
      // Track cursor position on every selection change so the AI agent can
      // insert content at the correct offset without reading the store synchronously.
      if (update.selectionSet || update.docChanged) {
        useStore.getState().setCursorOffset(update.state.selection.main.head);

        // Track highlighted text for the floating AI selection toolbar.
        const { from, to } = update.state.selection.main;
        if (from !== to) {
          const text = update.state.sliceDoc(from, to);
          // Get viewport-relative coordinates at the selection start to position the toolbar
          const coords = update.view.coordsAtPos(from);
          useStore.getState().setSelection(
            text,
            coords ? { top: coords.top, left: coords.left } : null,
            to, // always the end of the selection, regardless of drag direction
          );
        } else {
          useStore.getState().clearSelection();
        }
      }
    });

    const state = EditorState.create({
      doc: activeFileContent,
      extensions: [
        // GFM-capable markdown with embedded language highlighting
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        // 4-space indentation: controls both Tab key insertion and indent/dedent commands
        EditorState.tabSize.of(4),
        indentUnit.of("    "),
        oneDark,
        metisTheme,
        highlightCompartment.of(highlightForPreset(bgPresetRef.current)),
        metisLineNumbers,
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        search({
          createPanel: () => {
            const dom = document.createElement("span");
            dom.style.display = "none";
            return { dom };
          },
        }),
        codeBlockPlugin,
        copyButtonPlugin,
        calloutPlugin,
        // Wikilink autocomplete + slash menu (both share the autocompletion extension)
        ...wikilinkExtensions,
        // Collapse [Display](url) links to clean inline tokens while not editing
        ...markdownLinkCollapseExtension,
        // Clickable task markers in source mode (`[ ]` / `[x]`)
        ...taskListClickExtension,
        // List continuation (Enter key) — before defaultKeymap for priority
        listContinuationKeymap,
        // Markdown pair auto-complete — before defaultKeymap for priority
        markdownAutoComplete,
        // Smart paste: URL→link, image→asset
        smartPasteExtension,
        // Hide raw YAML frontmatter — MetadataPanel is the editing surface
        hideFrontmatterField,
        // Inline preview: renders images + enables Cmd+Click link following
        ...(activeFilePath && vaultPath
          ? makeInlinePreviewExtension(vaultPath, activeFilePath)
          : []),
        // Spellcheck linter — toggled via toolbar
        spellcheckCompartment.of(makeSpellcheckExt(spellcheckRef.current, spellcheckLangRef.current)),
        // Background colour — use current preset so switching files keeps the colour
        bgCompartment.of(makeBgTheme(bgPresetRef.current)),
        keymap.of([
          // Tab: indent the current line(s) by 4 spaces.
          // We bypass CodeMirror's language-aware `indentMore` because the
          // Markdown language service overrides indentUnit (2-space default).
          //
          // For single-cursor (no selection) we always prepend to the LINE
          // START so that list markers (-, *, 1.) shift together with their
          // text.  Inserting at the cursor position would leave the bullet
          // behind while the text moved right.
          {
            key: "Tab",
            run(view) {
              const { state } = view;
              if (state.selection.main.empty) {
                const pos = state.selection.main.from;
                const line = state.doc.lineAt(pos);
                const isListItem = /^\s*([-*+]|\d+\.)\s/.test(line.text);
                if (isListItem) {
                  // Insert at line start so marker + text shift together.
                  // No explicit selection needed — CM6 auto-maps the cursor
                  // forward because the insertion is before the cursor.
                  view.dispatch({
                    changes: { from: line.from, insert: "    " },
                  });
                } else {
                  // Insert at cursor. Explicit selection required because
                  // CM6's default mapping keeps the cursor before an
                  // insertion at its own position.
                  view.dispatch({
                    changes: { from: pos, insert: "    " },
                    selection: { anchor: pos + 4 },
                  });
                }
                return true;
              }
              const changes: { from: number; insert: string }[] = [];
              const touched = new Set<number>();
              for (const range of state.selection.ranges) {
                const fLine = state.doc.lineAt(range.from).number;
                const tLine = state.doc.lineAt(range.to).number;
                for (let n = fLine; n <= tLine; n++) {
                  if (!touched.has(n)) {
                    touched.add(n);
                    changes.push({ from: state.doc.line(n).from, insert: "    " });
                  }
                }
              }
              view.dispatch({ changes });
              return true;
            },
          },
          // Shift-Tab: list-aware outdent with child hierarchy support
          {
            key: "Shift-Tab",
            run(view) {
              const { state } = view;

              // ── Single cursor on a list item → list-aware logic ──
              if (state.selection.main.empty) {
                const pos = state.selection.main.from;
                const line = state.doc.lineAt(pos);
                const LIST_RE = /^(\s*)([-*+])\s+(\[[ xX]\] )?|^(\s*)(\d+)\.\s/;
                const listMatch = LIST_RE.exec(line.text);

                if (listMatch) {
                  const leadingWS = (listMatch[1] ?? listMatch[4] ?? "");
                  const indent = leadingWS.length;

                  if (indent === 0) {
                    const markerRE = /^\s*(?:[-*+]\s+(?:\[[ xX]\]\s?)?|\d+\.\s)/;
                    const mm = markerRE.exec(line.text);
                    const contentAfterMarker = mm ? line.text.slice(mm[0].length).trim() : "";
                    const colInLine = pos - line.from;

                    // If the line has content and cursor is past col 0,
                    // there's nothing to outdent — consume the key silently.
                    // But if the line is empty (just the marker), always strip it.
                    if (colInLine > 0 && contentAfterMarker.length > 0) {
                      return true;
                    }
                    if (mm) {
                      view.dispatch({
                        changes: { from: line.from, to: line.from + mm[0].length },
                        selection: { anchor: line.from },
                      });
                    }
                    return true;
                  }

                  // Indented list item — outdent parent + contiguous children
                  const lineNum = line.number;
                  let lastChild = lineNum;
                  for (let n = lineNum + 1; n <= state.doc.lines; n++) {
                    const l = state.doc.line(n);
                    if (l.text.trim() === "") { lastChild = n; continue; }
                    const childIndent = l.text.match(/^(\s*)/)![1].length;
                    if (childIndent > indent) lastChild = n;
                    else break;
                  }

                  const spacesToRemove = Math.min(4, indent);
                  const changes: { from: number; to: number }[] = [];
                  for (let n = lineNum; n <= lastChild; n++) {
                    const l = state.doc.line(n);
                    let rm = 0;
                    while (rm < spacesToRemove && l.text[rm] === " ") rm++;
                    if (rm > 0) {
                      changes.push({ from: l.from, to: l.from + rm });
                    }
                  }
                  if (changes.length) {
                    view.dispatch({ changes });
                  }
                  return true;
                }
              }

              // ── Non-list line or multi-line selection: generic outdent ──
              const changes: { from: number; to: number }[] = [];
              const touched = new Set<number>();
              for (const range of state.selection.ranges) {
                const fLine = state.doc.lineAt(range.from).number;
                const tLine = state.doc.lineAt(range.to).number;
                for (let n = fLine; n <= tLine; n++) {
                  if (!touched.has(n)) {
                    touched.add(n);
                    const l = state.doc.line(n);
                    let spaces = 0;
                    while (spaces < 4 && l.text[spaces] === " ") spaces++;
                    if (spaces > 0) {
                      changes.push({ from: l.from, to: l.from + spaces });
                    }
                  }
                }
              }
              if (changes.length) {
                view.dispatch({ changes });
              }
              // Always consume Shift-Tab to prevent browser tab-navigation
              // from stealing focus away from the editor.
              return true;
            },
          },
          {
            key: "Mod-f",
            run() {
              setFindBarOpen((prev) => {
                if (!prev) {
                  setFindBarReplace(false);
                  return true;
                }
                // Already open — focus the find input (handled via ref)
                findBarRef.current?.querySelector<HTMLInputElement>("input")?.focus();
                return true;
              });
              return true;
            },
          },
          {
            key: "Mod-r",
            run() {
              setFindBarOpen((prev) => {
                if (!prev) {
                  setFindBarReplace(true);
                  return true;
                }
                // Already open — ensure replace is visible and focus it
                setFindBarReplace(true);
                setTimeout(() => {
                  const inputs = findBarRef.current?.querySelectorAll<HTMLInputElement>("input");
                  if (inputs && inputs.length > 1) inputs[1].focus();
                  else inputs?.[0]?.focus();
                }, 0);
                return true;
              });
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          // Cmd/Ctrl+S → immediate manual save
          {
            key: "Mod-s",
            run(view) {
              invoke("save_note", {
                path: activeFilePath,
                content: view.state.doc.toString(),
              })
                .then(() => markSaved())
                .catch(console.error);
              return true;
            },
          },
          // Cmd/Ctrl+B → bold, Cmd/Ctrl+I → italic
          {
            key: "Mod-b",
            run(view) { toggleInline(view, "**"); return true; },
          },
          {
            key: "Mod-i",
            run(view) { toggleInline(view, "_"); return true; },
          },
        ]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorHostRef.current });
    viewRef.current = view;
    view.focus();

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilePath]);

  // ── Sync editor content when changed externally (e.g. agent file writes) ──
  //
  // The main effect only runs when `activeFilePath` changes.  When the agent
  // modifies the *current* file the path stays the same but `activeFileContent`
  // in the store is updated.  We detect the divergence here and push the new
  // content into CodeMirror via a single replace-all transaction.
  //
  // The equality guard prevents an infinite loop: after the dispatch the
  // editor fires its own updateListener → setActiveFileContent → this effect
  // runs again but sees `current === activeFileContent` and exits immediately.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || isImageFile) return;
    const current = view.state.doc.toString();
    if (current === activeFileContent) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: activeFileContent },
    });
  }, [activeFileContent, isImageFile]);

  // ── Hot-swap background colour without rebuilding the editor ─────────────
  useEffect(() => {
    bgPresetRef.current = bgPreset; // keep ref in sync for editor-creation effect
    viewRef.current?.dispatch({
      effects: [
        bgCompartment.reconfigure(makeBgTheme(bgPreset)),
        highlightCompartment.reconfigure(highlightForPreset(bgPreset)),
      ],
    });
  }, [bgPreset]);

  // ── Hot-swap spellcheck without rebuilding the editor ────────────────────
  useEffect(() => {
    spellcheckRef.current = spellcheck;
    spellcheckLangRef.current = spellcheckLang;
    localStorage.setItem("metis_spellcheck", String(spellcheck));
    viewRef.current?.dispatch({
      effects: spellcheckCompartment.reconfigure(makeSpellcheckExt(spellcheck, spellcheckLang)),
    });
  }, [spellcheck, spellcheckLang]);

  // ── When switching back to source mode, restore CM6 focus ─────────────────
  useEffect(() => {
    if (editorMode === "source") {
      // Small delay so the div is visible before requesting focus+measure
      const t = setTimeout(() => {
        viewRef.current?.requestMeasure();
        viewRef.current?.focus();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [editorMode]);

  // Ensure the color-picker popover never lingers across major view switches.
  // This avoids invisible fixed overlays blocking clicks after tab/file changes.
  useEffect(() => {
    setShowBgPicker(false);
  }, [editorMode, activeFilePath]);

  // Capture cursor position when entering Visual; restore editor scroll when returning to Source.
  useEffect(() => {
    const prev = prevEditorModeRef.current;
    prevEditorModeRef.current = editorMode;

    if (editorMode === "visual") {
      if (prev !== "visual") {
        setVisualScrollAnchor(useStore.getState().cursorOffset);
      }
      return;
    }

    setVisualScrollAnchor(null);

    if (prev === "visual" && editorMode === "source") {
      const id = requestAnimationFrame(() => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
        });
      });
      return () => cancelAnimationFrame(id);
    }
  }, [editorMode]);

  // ── Empty state ───────────────────────────────────────────────────────────────
  // Planner is a workspace view and should be accessible even when no file is open.
  if (!activeFilePath && editorMode !== "planner") {
    return (
      <div className="flex h-full flex-col bg-surface-base select-none">
        <div className="shrink-0 border-b border-border bg-surface-raised/70 px-4 py-2 backdrop-blur-sm" />
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mb-2 text-4xl text-text-muted opacity-30">⌘</div>
          <p className="text-sm text-text-muted">
            Select a note from the sidebar to start editing.
          </p>
          <p className="mt-1 text-xs text-text-muted opacity-60">
            Cmd+S to save · changes are also auto-saved
          </p>
        </div>
      </div>
    );
  }

  const fileName = activeFilePath ? activeFilePath.split("/").pop() ?? activeFilePath : "Planner";

  return (
    <div
      className="flex h-full flex-col bg-surface-base"
      data-color-scheme={bgPreset.isDark ? "dark" : "light"}
    >
      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className="relative z-30 flex shrink-0 items-center justify-between border-b border-border bg-surface-raised/70 px-4 py-1.5 backdrop-blur-sm">
        <span className="truncate text-xs text-text-secondary">{fileName}</span>

        <div className="flex shrink-0 items-center gap-2">
          {/* ── Background colour picker ──────────────────────────────── */}
          <div className="relative">
            <button
              title="Change background colour"
              onClick={() => setShowBgPicker((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2 py-0.5 text-xs text-text-muted transition-colors hover:text-text-primary"
            >
              {/* Colour swatch showing the active preset */}
              <span
                className="inline-block h-3 w-3 rounded-full border border-white/20"
                style={{ backgroundColor: bgPreset.bg }}
              />
              <span className="hidden sm:inline">{bgPreset.label}</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {/* Swatches popover */}
            {showBgPicker && (
              <>
                {/* Click-away overlay */}
                <div className="fixed inset-0 z-[70]" onClick={() => setShowBgPicker(false)} />
                <div className="absolute right-0 top-full z-[80] mt-1 flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised p-2 shadow-xl">
                  {BG_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      title={p.label}
                      onClick={() => { setBgPreset(p); setShowBgPicker(false); }}
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

          {/* ── Source / Visual mode toggle — notes only ───────────────── */}
          {!isImageFile && (
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5">
            {(["source", "visual"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setEditorMode(mode)}
                className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                  editorMode === mode
                    ? "bg-accent text-white"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          )}
        </div>
      </div>

      {/* ── Find / Replace bar ── */}
      {findBarOpen && (
        <div ref={findBarRef}>
          <EditorFindBar
            viewRef={viewRef}
            onClose={() => setFindBarOpen(false)}
            initialShowReplace={findBarReplace}
          />
        </div>
      )}

      {/* ── Formatting toolbar + metadata panel — hidden outside Source mode ── */}
      {editorMode === "source" && !isImageFile && (
        <Toolbar
          viewRef={viewRef}
          spellcheck={spellcheck}
          onToggleSpellcheck={() => setSpellcheck((v) => !v)}
        />
      )}

      {/* MetadataPanel is only needed in source mode; hiding it in Visual
          mode gives the preview the full vertical space of the editor pane. */}
      {editorMode === "source" && !isImageFile && (
        <MetadataPanel
          content={activeFileContent}
          filePath={activeFilePath}
          onContentChange={(newContent) => {
            const view = viewRef.current;
            if (!view) return;
            // Dispatch as a single CM6 transaction so undo/redo and auto-save work
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: newContent },
            });
          }}
          onLinkClick={(name) => {
            // Match by name (case-insensitive) and open the note
            const note = noteIndex.find(
              (n) => n.name === name || n.name.toLowerCase() === name.toLowerCase(),
            );
            if (!note) return;
            invoke<string>("get_file_content", { path: note.path })
              .then((c) => useStore.getState().setActiveFile(note.path, c))
              .catch(console.error);
          }}
        />
      )}

      {/* ── Floating AI selection toolbar (source mode only) ─────────────── */}
      {editorMode === "source" && !isImageFile && (
        <SelectionToolbar onDismiss={dismissSelectionToolbar} />
      )}

      {/* ── Editor / Preview area ────────────────────────────────────────── */}
      <div className="relative z-0 min-h-0 flex-1 overflow-hidden">
        {/* CodeMirror — always mounted so state/history is preserved.
            Hidden visually when preview is active. */}
        <div
          ref={editorHostRef}
          className="absolute inset-0"
          style={{
            display: editorMode === "source" && !isImageFile ? "block" : "none",
          }}
        />

        {isImageFile && activeFilePath && vaultPath && (
          <VaultImageViewer
            filePath={activeFilePath}
            vaultPath={vaultPath}
            bgColor={bgPreset.bg}
          />
        )}

        {/* Full rendered markdown preview — shown in visual mode only */}
        {editorMode === "visual" && activeFilePath && vaultPath && !isImageFile && (
          <MarkdownPreview
            content={activeFileContent}
            filePath={activeFilePath}
            vaultPath={vaultPath}
            bgColor={bgPreset.bg}
            textColor={bgPreset.fg}
            scrollAnchorOffset={visualScrollAnchor}
            onImageActivate={handlePreviewImageActivate}
          />
        )}

        {/* Planner view — standalone weekly task grid */}
        {editorMode === "planner" && (
          <div className="planner-theme h-full" style={plannerThemeVars(bgPreset)}>
            <DailyTaskGrid />
          </div>
        )}
      </div>

    </div>
  );
}
