import { useState, useRef, useCallback, useEffect } from "react";
import {
  Search,
  Replace,
  CaseSensitive,
  Regex,
  ChevronDown,
  ChevronRight,
  FileText,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";

interface SearchMatch {
  file_path: string;
  file_name: string;
  line_number: number;
  line_content: string;
  match_start: number;
  match_end: number;
}

interface ReplaceSummary {
  file_path: string;
  file_name: string;
  replacements: number;
}

interface FileGroup {
  fileName: string;
  nameMatch: SearchMatch | null;
  contentMatches: SearchMatch[];
}

type GroupedResults = Map<string, FileGroup>;

function groupByFile(matches: SearchMatch[]): GroupedResults {
  const map: GroupedResults = new Map();
  for (const m of matches) {
    let group = map.get(m.file_path);
    if (!group) {
      group = { fileName: m.file_name, nameMatch: null, contentMatches: [] };
      map.set(m.file_path, group);
    }
    if (m.line_number === 0) {
      group.nameMatch = m;
    } else {
      group.contentMatches.push(m);
    }
  }
  return map;
}

function HighlightedLine({
  line,
  start,
  end,
}: {
  line: string;
  start: number;
  end: number;
}) {
  const before = line.slice(0, start);
  const match = line.slice(start, end);
  const after = line.slice(end);
  return (
    <span className="font-mono text-[11px] leading-tight">
      <span className="text-text-muted">{before}</span>
      <span className="rounded-sm bg-yellow-500/30 text-yellow-200 px-px">
        {match}
      </span>
      <span className="text-text-muted">{after}</span>
    </span>
  );
}

/**
 * Highlights the matched portion within the file name while preserving the
 * full relative path display (directory prefix shown as muted text).
 */
function HighlightedFilename({
  relativePath,
  nameMatch,
}: {
  relativePath: string;
  nameMatch: SearchMatch;
}) {
  const lastSlash = relativePath.lastIndexOf("/");
  const dirPrefix = lastSlash >= 0 ? relativePath.slice(0, lastSlash + 1) : "";
  const stem = nameMatch.line_content; // filename without .md
  const ext = relativePath.endsWith(".md") ? ".md" : "";

  return (
    <span className="font-mono text-[11px] leading-tight">
      {dirPrefix && <span className="text-text-muted">{dirPrefix}</span>}
      <span className="text-text-muted">{stem.slice(0, nameMatch.match_start)}</span>
      <span className="rounded-sm bg-yellow-500/30 text-yellow-200 px-px">
        {stem.slice(nameMatch.match_start, nameMatch.match_end)}
      </span>
      <span className="text-text-muted">{stem.slice(nameMatch.match_end)}{ext}</span>
    </span>
  );
}

export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexMode, setRegexMode] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replaceResult, setReplaceResult] = useState<ReplaceSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSidebarView = useStore((s) => s.setSidebarView);
  const vaultPath = useStore((s) => s.vaultPath);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setHasSearched(false);
        setError(null);
        return;
      }
      setSearching(true);
      setError(null);
      setReplaceResult(null);
      try {
        const matches = await invoke<SearchMatch[]>("search_vault", {
          query: q,
          caseSensitive,
          regexMode,
        });
        setResults(matches);
        setHasSearched(true);
      } catch (err) {
        setError(String(err));
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [caseSensitive, regexMode],
  );

  const onQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        doSearch(query);
      }
      if (e.key === "Escape") {
        setSidebarView("files");
      }
    },
    [doSearch, query, setSidebarView],
  );

  const handleReplaceAll = useCallback(async () => {
    if (!query.trim() || replacing) return;
    setReplacing(true);
    setError(null);
    try {
      const summaries = await invoke<ReplaceSummary[]>("replace_in_vault", {
        query,
        replacement,
        caseSensitive,
        regexMode,
      });
      setReplaceResult(summaries);
      // Re-search to update results
      doSearch(query);
      // Refresh vault tree in case filenames changed or files were modified
      useStore.getState().refreshVault();
    } catch (err) {
      setError(String(err));
    } finally {
      setReplacing(false);
    }
  }, [query, replacement, caseSensitive, regexMode, replacing, doSearch]);

  const openMatch = useCallback(
    async (m: SearchMatch) => {
      try {
        const content = await invoke<string>("get_file_content", {
          path: m.file_path,
        });
        useStore.getState().setActiveFile(m.file_path, content);

        // Filename matches (line_number === 0) just open the file.
        if (m.line_number === 0) return;

        // Scroll to the matching line after the editor mounts.
        // The editor re-creates on activeFilePath change, so we wait a tick.
        setTimeout(() => {
          const lines = content.split("\n");
          let offset = 0;
          for (let i = 0; i < m.line_number - 1 && i < lines.length; i++) {
            offset += lines[i].length + 1;
          }
          offset += m.match_start;
          useStore.getState().setCursorOffset(offset);
        }, 100);
      } catch (err) {
        console.error("Failed to open match:", err);
      }
    },
    [],
  );

  const toggleCollapse = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  // Re-search when toggles change (if we have a query)
  useEffect(() => {
    if (query.trim()) doSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSensitive, regexMode]);

  const grouped = groupByFile(results);
  const totalFiles = grouped.size;
  const nameMatchCount = [...grouped.values()].filter((g) => g.nameMatch).length;
  const totalMatches = results.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          onClick={() => setSidebarView("files")}
          className="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
          title="Back to files"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-semibold text-text-secondary">
          Search
        </span>
      </div>

      {/* Search input row */}
      <div className="shrink-0 border-b border-border px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <Search size={13} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search vault…"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
            spellCheck={false}
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            className={`rounded p-0.5 transition-colors ${caseSensitive ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
          >
            <CaseSensitive size={14} />
          </button>
          <button
            onClick={() => setRegexMode((v) => !v)}
            title="Use regular expression"
            className={`rounded p-0.5 transition-colors ${regexMode ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
          >
            <Regex size={14} />
          </button>
          <button
            onClick={() => setShowReplace((v) => !v)}
            title="Toggle replace"
            className={`rounded p-0.5 transition-colors ${showReplace ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-primary"}`}
          >
            <Replace size={14} />
          </button>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div className="flex items-center gap-1.5">
            <Replace size={13} className="shrink-0 text-text-muted" />
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Replace with…"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
              spellCheck={false}
            />
            <button
              onClick={handleReplaceAll}
              disabled={!query.trim() || replacing}
              title="Replace all in vault"
              className="whitespace-nowrap rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent border border-accent/30 transition-colors hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {replacing ? "Replacing…" : "Replace All"}
            </button>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[10px] text-text-muted">
        {searching && (
          <Loader2 size={11} className="animate-spin text-accent" />
        )}
        {hasSearched && !searching && (
          <span>
            {totalMatches >= 1000 ? "1000+" : totalMatches} result
            {totalMatches !== 1 ? "s" : ""} in {totalFiles} file
            {totalFiles !== 1 ? "s" : ""}
            {nameMatchCount > 0 && (
              <span className="text-accent">
                {" "}({nameMatchCount} name {nameMatchCount !== 1 ? "matches" : "match"})
              </span>
            )}
          </span>
        )}
        {replaceResult && !replacing && (
          <span className="text-green-400">
            Replaced in {replaceResult.length} file
            {replaceResult.length !== 1 ? "s" : ""} (
            {replaceResult.reduce((a, r) => a + r.replacements, 0)} total)
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 px-3 py-1.5 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {hasSearched && !searching && results.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-text-muted">
            No results found.
          </div>
        )}

        {[...grouped.entries()].map(([filePath, group]) => {
          const collapsed = collapsedFiles.has(filePath);
          const relativePath = vaultPath
            ? filePath.replace(vaultPath + "/", "")
            : group.fileName;
          const matchCount = group.contentMatches.length + (group.nameMatch ? 1 : 0);

          return (
            <div key={filePath} className="mb-0.5">
              {/* File header */}
              <button
                onClick={() => {
                  if (group.contentMatches.length === 0 && group.nameMatch) {
                    openMatch(group.nameMatch);
                  } else {
                    toggleCollapse(filePath);
                  }
                }}
                className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-surface-overlay${group.nameMatch ? " ring-1 ring-accent/30" : ""}`}
              >
                {collapsed ? (
                  <ChevronRight size={12} className="shrink-0 text-text-muted" />
                ) : (
                  <ChevronDown size={12} className="shrink-0 text-text-muted" />
                )}
                <FileText size={12} className={`shrink-0 ${group.nameMatch ? "text-accent" : "text-accent/70"}`} />
                <span className="min-w-0 truncate text-[11px] font-medium text-text-secondary">
                  {group.nameMatch ? (
                    <HighlightedFilename
                      relativePath={relativePath}
                      nameMatch={group.nameMatch}
                    />
                  ) : (
                    relativePath
                  )}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-text-muted">
                  {matchCount}
                </span>
              </button>

              {/* Content match lines */}
              {!collapsed &&
                group.contentMatches.map((m, i) => (
                  <button
                    key={`${m.line_number}-${i}`}
                    onClick={() => openMatch(m)}
                    className="flex w-full items-start gap-2 rounded px-2 py-0.5 pl-7 text-left transition-colors hover:bg-surface-overlay"
                  >
                    <span className="shrink-0 w-7 text-right text-[10px] text-text-muted tabular-nums">
                      {m.line_number}
                    </span>
                    <span className="min-w-0 truncate">
                      <HighlightedLine
                        line={m.line_content}
                        start={m.match_start}
                        end={m.match_end}
                      />
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
