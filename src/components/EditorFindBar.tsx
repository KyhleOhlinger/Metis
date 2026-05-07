import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  openSearchPanel,
  closeSearchPanel,
  SearchCursor,
  RegExpCursor,
} from "@codemirror/search";
import {
  CaseSensitive,
  Regex,
  ChevronUp,
  ChevronDown,
  X,
  Replace,
} from "lucide-react";

interface EditorFindBarProps {
  viewRef: React.RefObject<EditorView | null>;
  onClose: () => void;
  initialShowReplace?: boolean;
}

function countMatches(
  view: EditorView,
  search: string,
  caseSensitive: boolean,
  isRegex: boolean,
): { total: number; current: number } {
  if (!search) return { total: 0, current: 0 };

  const { state } = view;
  const selHead = state.selection.main.head;
  let total = 0;
  let current = 0;

  try {
    if (isRegex) {
      const cursor = new RegExpCursor(state.doc, search, {
        ignoreCase: !caseSensitive,
      });
      while (!cursor.next().done) {
        total++;
        if (
          current === 0 &&
          cursor.value.from <= selHead &&
          cursor.value.to >= selHead
        ) {
          current = total;
        }
      }
    } else {
      const cursor = new SearchCursor(
        state.doc,
        search,
        0,
        state.doc.length,
        caseSensitive ? undefined : (a) => a.toLowerCase(),
      );
      while (!cursor.next().done) {
        total++;
        if (
          current === 0 &&
          cursor.value.from <= selHead &&
          cursor.value.to >= selHead
        ) {
          current = total;
        }
      }
    }
  } catch {
    // Invalid regex — suppress
  }

  return { total, current };
}

export default function EditorFindBar({
  viewRef,
  onClose,
  initialShowReplace = false,
}: EditorFindBarProps) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(initialShowReplace);
  const [matchInfo, setMatchInfo] = useState({ total: 0, current: 0 });

  const findInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill with the editor's current selection on mount, and activate
  // CM6's internal search panel state so match highlighting works.
  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      // Open CM6's hidden panel — this flips the internal flag that the
      // search highlighter checks before drawing match decorations.
      openSearchPanel(view);

      const { from, to } = view.state.selection.main;
      if (from !== to) {
        const sel = view.state.sliceDoc(from, to);
        if (sel.length < 200 && !sel.includes("\n")) {
          setFindText(sel);
          // Re-dispatch immediately so the query from openSearchPanel is
          // overridden before the first paint.
          try {
            view.dispatch({
              effects: setSearchQuery.of(
                new SearchQuery({ search: sel, caseSensitive: false, regexp: false }),
              ),
            });
          } catch { /* ignore */ }
        }
      }
    }
    setTimeout(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncQuery = useCallback(
    (search: string, replace: string, cs: boolean, re: boolean) => {
      const view = viewRef.current;
      if (!view) return;
      try {
        const query = new SearchQuery({
          search,
          caseSensitive: cs,
          regexp: re,
          replace,
        });
        view.dispatch({ effects: setSearchQuery.of(query) });
      } catch {
        // Invalid regex — dispatch empty search to clear highlights
        view.dispatch({
          effects: setSearchQuery.of(new SearchQuery({ search: "" })),
        });
      }
    },
    [viewRef],
  );

  const refreshMatchCount = useCallback(() => {
    const view = viewRef.current;
    if (!view || !findText) {
      setMatchInfo({ total: 0, current: 0 });
      return;
    }
    setMatchInfo(countMatches(view, findText, caseSensitive, useRegex));
  }, [viewRef, findText, caseSensitive, useRegex]);

  // Sync query + count on every change
  useEffect(() => {
    syncQuery(findText, replaceText, caseSensitive, useRegex);
    refreshMatchCount();
  }, [findText, replaceText, caseSensitive, useRegex, syncQuery, refreshMatchCount]);

  // Refresh the "current" counter after the user navigates
  const afterNav = useCallback(() => {
    setTimeout(refreshMatchCount, 10);
  }, [refreshMatchCount]);

  const handleFindNext = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      findNext(view);
      afterNav();
    }
  }, [viewRef, afterNav]);

  const handleFindPrev = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      findPrevious(view);
      afterNav();
    }
  }, [viewRef, afterNav]);

  const handleReplace = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      replaceNext(view);
      afterNav();
    }
  }, [viewRef, afterNav]);

  const handleReplaceAll = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      replaceAll(view);
      afterNav();
    }
  }, [viewRef, afterNav]);

  const handleClose = useCallback(() => {
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: "" })),
      });
      closeSearchPanel(view);
      view.focus();
    }
    onClose();
  }, [viewRef, onClose]);

  const isCloseShortcut = useCallback(
    (e: React.KeyboardEvent) =>
      (e.metaKey || e.ctrlKey) &&
      (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "r"),
    [],
  );

  const handleFindKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCloseShortcut(e)) {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) handleFindPrev();
        else handleFindNext();
      }
    },
    [handleClose, handleFindNext, handleFindPrev, isCloseShortcut],
  );

  const handleReplaceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isCloseShortcut(e)) {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) handleReplaceAll();
        else handleReplace();
      }
    },
    [handleClose, handleReplace, handleReplaceAll, isCloseShortcut],
  );

  const statusText = useMemo(() => {
    if (!findText) return "";
    if (matchInfo.total === 0) return "No results";
    if (matchInfo.current > 0)
      return `${matchInfo.current} of ${matchInfo.total}`;
    return `${matchInfo.total} result${matchInfo.total !== 1 ? "s" : ""}`;
  }, [findText, matchInfo]);

  return (
    <div className="shrink-0 border-b border-border bg-surface-raised/80 px-3 py-1.5 backdrop-blur-sm">
      {/* Find row */}
      <div className="flex items-center gap-1.5">
        {/* Toggle replace */}
        <button
          onClick={() => setShowReplace((v) => !v)}
          title={showReplace ? "Hide replace" : "Show replace"}
          className={`rounded p-0.5 transition-colors ${showReplace ? "text-accent" : "text-text-muted hover:text-text-primary"}`}
        >
          <Replace size={13} />
        </button>

        <input
          ref={findInputRef}
          type="text"
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          onKeyDown={handleFindKeyDown}
          placeholder="Find…"
          className="min-w-0 flex-1 rounded border border-border bg-surface-base px-2 py-[3px] text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
          spellCheck={false}
        />

        {/* Match count */}
        {findText && (
          <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
            {statusText}
          </span>
        )}

        {/* Navigation */}
        <button
          onClick={handleFindPrev}
          disabled={matchInfo.total === 0}
          title="Previous match (Shift+Enter)"
          className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary disabled:opacity-30"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={handleFindNext}
          disabled={matchInfo.total === 0}
          title="Next match (Enter)"
          className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary disabled:opacity-30"
        >
          <ChevronDown size={14} />
        </button>

        {/* Toggles */}
        <button
          onClick={() => setCaseSensitive((v) => !v)}
          title="Match case"
          className={`rounded p-0.5 transition-colors ${caseSensitive ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
        >
          <CaseSensitive size={14} />
        </button>
        <button
          onClick={() => setUseRegex((v) => !v)}
          title="Use regular expression"
          className={`rounded p-0.5 transition-colors ${useRegex ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
        >
          <Regex size={14} />
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          title="Close (Escape)"
          className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={14} />
        </button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="mt-1.5 flex items-center gap-1.5 pl-[25px]">
          <input
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            placeholder="Replace…"
            className="min-w-0 flex-1 rounded border border-border bg-surface-base px-2 py-[3px] text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
            spellCheck={false}
          />
          <button
            onClick={handleReplace}
            disabled={!findText || matchInfo.total === 0}
            title="Replace (Enter)"
            className="shrink-0 rounded-md border border-border px-2 py-[3px] text-[10px] font-medium text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!findText || matchInfo.total === 0}
            title="Replace all (Shift+Enter)"
            className="shrink-0 rounded-md border border-accent/30 bg-accent/10 px-2 py-[3px] text-[10px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Replace All
          </button>
        </div>
      )}
    </div>
  );
}
