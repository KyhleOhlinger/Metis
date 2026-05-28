import { useEffect, useRef, type MutableRefObject } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, highlightActiveLine } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { indentUnit } from "@codemirror/language";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import {
  plannerAdaptiveHighlightStyle,
  plannerMarkdownVisualExtensions,
} from "./editorExtensions";

const plannerCmBaseTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--planner-surface-raised) !important",
      color: "var(--planner-text-primary) !important",
      borderRadius: "4px",
    },
    ".cm-scroller": {
      fontFamily: '"Inter","SF Pro Text",system-ui,sans-serif',
      lineHeight: "1.45",
      backgroundColor: "var(--planner-surface-raised) !important",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "6px 8px",
      caretColor: "#7c3aed",
      minHeight: "100%",
      fontWeight: "400",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(124, 58, 237, 0.08) !important",
    },
    ".cm-cursor": {
      borderLeftColor: "#7c3aed",
    },
  },
  { dark: true },
);

function makeSizeTheme(minHeightPx: number, fillHeight: boolean) {
  if (fillHeight) {
    return EditorView.theme({
      "&": {
        flex: "1 1 0%",
        minHeight: `${Math.max(48, minHeightPx)}px`,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      },
      ".cm-editor": {
        flex: "1 1 0%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      },
      ".cm-scroller": {
        flex: "1 1 0%",
        minHeight: 0,
        overflow: "auto",
      },
    });
  }

  return EditorView.theme({
    "&": { minHeight: `${minHeightPx}px`, maxHeight: `${minHeightPx}px` },
    ".cm-editor": { minHeight: `${minHeightPx}px`, maxHeight: `${minHeightPx}px` },
    ".cm-scroller": {
      minHeight: `${minHeightPx}px`,
      maxHeight: `${minHeightPx}px`,
      overflow: "auto",
    },
  });
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  minHeightPx?: number;
  toolbarViewRef: MutableRefObject<EditorView | null>;
  /** Cell font size in px; default `11` (weekly/monthly cells). Use `10` for Daily Log to match former textareas. */
  fontSizePx?: number;
  /** Grow with a flex parent (e.g. Daily Log weighted grid); `minHeightPx` is a minimum floor. */
  fillHeight?: boolean;
  /** Called when this editor receives focus (in addition to wiring the shared toolbar ref). */
  onEditorFocus?: () => void;
  /** Called when this editor loses focus. */
  onEditorBlur?: () => void;
}

/**
 * Lightweight markdown editor for Planner cells — shares the main note Toolbar
 * via toolbarViewRef while focused.
 */
export default function PlannerCodeMirrorField({
  value,
  onChange,
  minHeightPx = 96,
  toolbarViewRef,
  fontSizePx = 11,
  fillHeight = false,
  onEditorFocus,
  onEditorBlur,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorFocusRef = useRef(onEditorFocus);
  onEditorFocusRef.current = onEditorFocus;
  const onEditorBlurRef = useRef(onEditorBlur);
  onEditorBlurRef.current = onEditorBlur;
  const sizeCompartmentRef = useRef(new Compartment());
  const fontCompartmentRef = useRef(new Compartment());
  const fillHeightRef = useRef(fillHeight);
  fillHeightRef.current = fillHeight;
  const minHeightRef = useRef(minHeightPx);
  minHeightRef.current = minHeightPx;
  const fontSizeRef = useRef(fontSizePx);
  fontSizeRef.current = fontSizePx;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const fontTheme = EditorView.theme({
      ".cm-scroller": {
        fontSize: `${fontSizeRef.current}px`,
        lineHeight: fontSizeRef.current <= 10 ? "1.42" : "1.45",
        fontWeight: "400",
      },
    });

    const state = EditorState.create({
      doc: valueRef.current,
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorState.tabSize.of(4),
        indentUnit.of("    "),
        plannerCmBaseTheme,
        fontCompartmentRef.current.of(fontTheme),
        plannerAdaptiveHighlightStyle,
        ...plannerMarkdownVisualExtensions,
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        sizeCompartmentRef.current.of(
          makeSizeTheme(minHeightRef.current, fillHeightRef.current),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          if (text === valueRef.current) return;
          onChangeRef.current(text);
        }),
        EditorView.domEventHandlers({
          focus() {
            toolbarViewRef.current = viewRef.current;
            onEditorFocusRef.current?.();
          },
          blur(_event, view) {
            requestAnimationFrame(() => {
              if (view.hasFocus) return;
              const active = document.activeElement;
              if (active?.closest("[data-metis-planner-toolbar]")) return;
              onEditorBlurRef.current?.();
            });
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    return () => {
      if (toolbarViewRef.current === view) toolbarViewRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
    // toolbarViewRef is a stable ref object from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once; geometry/font via compartments
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        sizeCompartmentRef.current.reconfigure(
          makeSizeTheme(minHeightPx, fillHeight),
        ),
        fontCompartmentRef.current.reconfigure(
          EditorView.theme({
            ".cm-scroller": {
              fontSize: `${fontSizePx}px`,
              lineHeight: fontSizePx <= 10 ? "1.42" : "1.45",
              fontWeight: "400",
            },
          }),
        ),
      ],
    });
  }, [minHeightPx, fillHeight, fontSizePx]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === value) return;
    view.dispatch({
      changes: { from: 0, to: cur.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={hostRef}
      className={
        fillHeight
          ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-border bg-surface-raised"
          : "overflow-hidden rounded border border-border bg-surface-raised"
      }
    />
  );
}
