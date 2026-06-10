/**
 * MetadataPanel — collapsible header above the editor.
 *
 * Sections (when expanded):
 *   • File name — rename via Rust `rename_path`
 *   • Properties — always-visible smart fields: status, date, parent (auto),
 *     aliases.  Controls are purpose-built (select / date picker / text input)
 *     and write directly to YAML frontmatter.  `parent` is read-only — derived
 *     from the containing folder.
 *   • Tags — editable chips backed by the `tags:` frontmatter key
 *   • Fields — arbitrary extra frontmatter key/value pairs (smart keys
 *     are filtered out here to avoid duplication with Properties)
 *   • Links — [[wikilinks]] and inline #hashtags found in the body
 *     (read-only — they live in the note body, not frontmatter)
 *
 * All edits call `onContentChange(newContent)` which the parent (Editor.tsx)
 * dispatches as a CodeMirror transaction so undo/redo and auto-save work.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store/useStore";
import { STATUS_COLORS } from "../constants";

// ── Smart-field constants ─────────────────────────────────────────────────────

const STATUS_VALUES = ["draft", "in-progress", "review", "done", "archived"] as const;

/**
 * Keys that get dedicated controls in the Properties section and are therefore
 * hidden from the generic Fields section to avoid duplication.
 */
const SMART_KEYS = new Set(["status", "date", "created", "updated", "parent", "aliases", "related"]);

/** Keys whose values are comma-separated lists and should be serialised as YAML inline arrays. */
const LIST_KEYS = new Set(["aliases"]);

// ── YAML frontmatter parsing ──────────────────────────────────────────────────

interface FrontmatterData {
  tags: string[];
  fields: [string, string][]; // [key, raw-value] — excludes the `tags` key
}

function parseFrontmatter(content: string): FrontmatterData & { bodyStart: number } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { tags: [], fields: [], bodyStart: 0 };

  const yaml = match[1];
  const bodyStart = match[0].length;
  const tags: string[] = [];
  const fields: [string, string][] = [];

  const lines = yaml.split(/\r?\n/);
  let currentKey = "";
  let currentItems: string[] = [];
  let inList = false;

  const flush = () => {
    if (!currentKey) return;
    if (inList) {
      if (currentKey === "tags") tags.push(...currentItems);
      else fields.push([currentKey, currentItems.join(", ")]);
    }
    currentKey = "";
    currentItems = [];
    inList = false;
  };

  for (const line of lines) {
    const listMatch = line.match(/^\s+-\s+(.*)/);
    const kvMatch   = line.match(/^([\w][\w-]*):\s*(.*)/);

    if (listMatch && inList) {
      currentItems.push(listMatch[1].trim().replace(/^['"]|['"]$/g, ""));
    } else if (kvMatch) {
      flush();
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === "" || val === "[]") {
        inList = true;
      } else if (val.startsWith("[") && val.endsWith("]")) {
        const items = val.slice(1, -1).split(",").map((t) => t.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
        if (currentKey === "tags") { tags.push(...items); currentKey = ""; }
        else { fields.push([currentKey, items.join(", ")]); currentKey = ""; }
      } else {
        if (currentKey === "tags") { tags.push(val); currentKey = ""; }
        else { fields.push([currentKey, val]); currentKey = ""; }
      }
    } else {
      flush();
    }
  }
  flush();

  return { tags, fields, bodyStart };
}

function serializeFrontmatter(tags: string[], fields: [string, string][]): string {
  const lines: string[] = [];
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((t) => (t.includes(" ") ? `"${t}"` : t)).join(", ")}]`);
  }
  for (const [k, v] of fields) {
    if (!k.trim()) continue;
    if (LIST_KEYS.has(k) && v.trim()) {
      // Serialize list keys as proper YAML inline arrays
      const items = v.split(",").map((s) => s.trim()).filter(Boolean);
      lines.push(`${k}: [${items.join(", ")}]`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n`;
}

function applyFrontmatter(content: string, tags: string[], fields: [string, string][]): string {
  const { bodyStart } = parseFrontmatter(content);
  const fm = serializeFrontmatter(tags, fields);

  if (bodyStart > 0) {
    // Existing frontmatter: `bodyStart` sits right after the closing `---\n`,
    // so body already carries any blank lines that were between `---` and the
    // note body.  Concatenating without an extra `\n` preserves them exactly.
    const body = content.slice(bodyStart);
    return fm ? `${fm}${body}` : body;
  } else {
    // No frontmatter yet — inserting a fresh block.  Add one separator newline
    // between the new `---` block and the existing body text.
    const body = content;
    if (!fm) return body;
    return body.length > 0 ? `${fm}\n${body}` : fm;
  }
}

// ── Body metadata (wikilinks + inline hashtags) ───────────────────────────────

function parseBodyMeta(content: string, bodyStart: number) {
  const body = content.slice(bodyStart);
  const bodyWithoutCode = body.replace(/```[\s\S]*?```|`[^`]+`/g, "");

  const linksSeen = new Set<string>();
  const links: string[] = [];
  for (const m of bodyWithoutCode.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]*?)?\]\]/g)) {
    const name = m[1].trim();
    if (!linksSeen.has(name)) { linksSeen.add(name); links.push(name); }
  }

  const inlineTags: string[] = [];
  const inlineTagSeen = new Set<string>();
  for (const m of bodyWithoutCode.matchAll(/#([a-zA-Z][a-zA-Z0-9_/-]*)/g)) {
    const key = m[1].toLowerCase();
    if (!inlineTagSeen.has(key)) { inlineTagSeen.add(key); inlineTags.push(m[1]); }
  }

  return { links, inlineTags };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  content: string;
  filePath: string | null;
  onContentChange: (newContent: string) => void;
  onLinkClick?: (name: string) => void;
}

export default function MetadataPanel({ content, filePath, onContentChange, onLinkClick }: Props) {
  const [open, setOpen] = useState(false);
  const { refreshVault, vaultPath } = useStore(
    useShallow((s) => ({ refreshVault: s.refreshVault, vaultPath: s.vaultPath })),
  );

  // Auto-derive parent folder from the file path (read-only — not written to frontmatter).
  // Returns null when the note lives directly at the vault root.
  const autoParent = useMemo<string | null>(() => {
    if (!filePath || !vaultPath) return null;
    const rel = filePath.startsWith(vaultPath) ? filePath.slice(vaultPath.length).replace(/^\//, "") : filePath;
    const segments = rel.split("/");
    // If only one segment the note is at the vault root — no meaningful parent folder.
    return segments.length > 1 ? segments[segments.length - 2] : null;
  }, [filePath, vaultPath]);

  const currentFileName = filePath ? filePath.split("/").pop() ?? "" : "";
  const parsed = useMemo(() => parseFrontmatter(content), [content]);
  const body   = useMemo(() => parseBodyMeta(content, parsed.bodyStart), [content, parsed.bodyStart]);

  // ── File rename ──────────────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(currentFileName);
  const [renameError, setRenameError] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraftName(currentFileName); setEditingName(false); setRenameError(""); }, [currentFileName]);
  useEffect(() => { if (editingName) nameInputRef.current?.select(); }, [editingName]);

  async function commitRename() {
    const newName = draftName.trim();
    setEditingName(false);
    if (!newName || !filePath) return;
    // Allow case-only renames (e.g. note.md → Note.md); skip exact match only.
    if (newName === currentFileName) return;
    try {
      const newPath = await invoke<string>("rename_path", { path: filePath, newName });
      useStore.setState({ activeFilePath: newPath });
      await refreshVault();
    } catch (e) { setRenameError(String(e)); setDraftName(currentFileName); }
  }

  // ── Tag editing ──────────────────────────────────────────────────────────────
  const [tags, setTags] = useState<string[]>([]);
  const [editingTagIdx, setEditingTagIdx] = useState<number | null>(null);
  const [draftTag, setDraftTag] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState("");
  const tagInputRef    = useRef<HTMLInputElement>(null);
  const newTagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTags(parsed.tags); }, [parsed.tags.join(",")]);
  useEffect(() => { if (editingTagIdx !== null) tagInputRef.current?.select(); }, [editingTagIdx]);
  useEffect(() => { if (addingTag) newTagInputRef.current?.focus(); }, [addingTag]);

  const pushTagsToContent = useCallback((newTags: string[]) => {
    onContentChange(applyFrontmatter(content, newTags, parsed.fields));
  }, [content, parsed.fields, onContentChange]);

  function commitTagEdit() {
    const trimmed = draftTag.trim().replace(/^#+/, "");
    let next = [...tags];
    if (editingTagIdx !== null) {
      if (trimmed) next[editingTagIdx] = trimmed; else next.splice(editingTagIdx, 1);
    }
    setEditingTagIdx(null); setDraftTag("");
    setTags(next); pushTagsToContent(next);
  }

  function removeTag(idx: number) {
    const next = tags.filter((_, i) => i !== idx);
    setTags(next); pushTagsToContent(next);
  }

  function commitNewTag() {
    const trimmed = newTagDraft.trim().replace(/^#+/, "");
    if (trimmed && !tags.includes(trimmed)) {
      const next = [...tags, trimmed]; setTags(next); pushTagsToContent(next);
    }
    setNewTagDraft(""); setAddingTag(false);
  }

  // ── Frontmatter field editing ────────────────────────────────────────────────
  const [fields, setFields] = useState<[string, string][]>([]);
  const [editingField, setEditingField] = useState<{ idx: number; part: "key" | "val" } | null>(null);
  const [draftField, setDraftField] = useState("");
  const [addingField, setAddingField] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const newKeyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setFields(parsed.fields); }, [JSON.stringify(parsed.fields)]);
  useEffect(() => { if (addingField) newKeyInputRef.current?.focus(); }, [addingField]);

  const pushFieldsToContent = useCallback((newFields: [string, string][]) => {
    onContentChange(applyFrontmatter(content, tags, newFields));
  }, [content, tags, onContentChange]);

  function commitFieldEdit() {
    if (!editingField) return;
    const next: [string, string][] = fields.map((f, i) =>
      i === editingField.idx
        ? (editingField.part === "key" ? [draftField.trim() || f[0], f[1]] : [f[0], draftField])
        : f
    );
    setEditingField(null); setDraftField("");
    setFields(next); pushFieldsToContent(next);
  }

  function removeField(idx: number) {
    const next = fields.filter((_, i) => i !== idx);
    setFields(next); pushFieldsToContent(next);
  }

  function commitNewField() {
    const k = newKey.trim(); const v = newVal.trim();
    if (!k) { setAddingField(false); setNewKey(""); setNewVal(""); return; }
    const next: [string, string][] = [...fields, [k, v]];
    setFields(next); pushFieldsToContent(next);
    setAddingField(false); setNewKey(""); setNewVal("");
  }

  // ── Smart-field helpers ───────────────────────────────────────────────────────
  // Read a smart-field value from the fields array (strips [[]] from parent).
  function getSmartValue(key: string): string {
    const entry = fields.find(([k]) => k === key);
    if (!entry) return "";
    // Strip [[wikilink]] brackets when displaying parent
    return key === "parent"
      ? entry[1].replace(/^\[\[|\]\]$/g, "").trim()
      : entry[1];
  }

  // Write or delete a smart-field value in the fields array.
  function setSmartValue(key: string, raw: string) {
    const value = raw;

    let next: [string, string][];
    const idx = fields.findIndex(([k]) => k === key);

    if (!value.trim()) {
      // Clear the key entirely
      next = fields.filter(([k]) => k !== key);
    } else if (idx >= 0) {
      next = fields.map((f, i) => (i === idx ? [key, value] : f));
    } else {
      // Insert smart keys in a predictable order before generic fields
      const SMART_ORDER = ["status", "date", "aliases"];
      const insertAfter = SMART_ORDER.indexOf(key);
      // Find the last smart key already in the list that comes before this one
      let insertIdx = 0;
      for (let i = fields.length - 1; i >= 0; i--) {
        const pos = SMART_ORDER.indexOf(fields[i][0]);
        if (pos !== -1 && pos < insertAfter) { insertIdx = i + 1; break; }
      }
      next = [...fields.slice(0, insertIdx), [key, value], ...fields.slice(insertIdx)];
    }

    setFields(next);
    pushFieldsToContent(next);
  }

  // ── Summary for collapsed bar ─────────────────────────────────────────────
  const statusField = fields.find(([k]) => k === "status");
  const genericFields = fields.filter(([k]) => !SMART_KEYS.has(k));
  const collapsedHint = [
    tags.length > 0 && `${tags.length} tag${tags.length !== 1 ? "s" : ""}`,
    body.links.length > 0 && `${body.links.length} link${body.links.length !== 1 ? "s" : ""}`,
    genericFields.length > 0 && `${genericFields.length} field${genericFields.length !== 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="shrink-0 border-b border-border bg-surface-raised">

      {/* ── Toggle bar ─────────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors hover:bg-surface-overlay"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          Metadata
        </span>
        {!open && currentFileName && (
          <span className="ml-1 truncate max-w-[160px] text-[9px] font-mono text-text-secondary">
            {currentFileName}
          </span>
        )}
        {statusField && !open && (
          <span className={`ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${STATUS_COLORS[statusField[1]] ?? "text-text-muted bg-surface-overlay"}`}>
            {statusField[1]}
          </span>
        )}
        {collapsedHint && !open && (
          <span className="ml-auto shrink-0 text-[9px] text-text-muted opacity-60">{collapsedHint}</span>
        )}
      </button>

      {/* ── Expanded body ──────────────────────────────────────────────────── */}
      {/* max-h caps growth so the editor flex column is never squeezed out */}
      {open && (
        <div className="max-h-[40vh] overflow-y-auto px-3 pb-3 pt-1 space-y-3">

          {/* ── File name ───────────────────────────────────────────────── */}
          <Row label="File Name">
            {editingName ? (
              <input ref={nameInputRef} value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setEditingName(false); setDraftName(currentFileName); }
                }}
                onBlur={commitRename}
                className="w-full rounded border border-accent bg-surface-base px-2 py-0.5 text-xs font-mono text-text-primary focus:outline-none"
              />
            ) : (
              <button onClick={() => setEditingName(true)} title="Click to rename"
                className="group flex items-center gap-1.5 text-[11px] font-mono text-text-secondary hover:text-text-primary transition-colors">
                <span>{currentFileName}</span>
                <PencilIcon />
              </button>
            )}
            {renameError && <p className="mt-0.5 text-[10px] text-red-400">{renameError}</p>}
          </Row>

          {/* ── Properties (smart fields) ───────────────────────────────── */}
          <Row label="Properties">
            <div className="space-y-1.5">

              {/* Status */}
              <PropRow label="status">
                <select
                  value={getSmartValue("status")}
                  onChange={(e) => setSmartValue("status", e.target.value)}
                  className={`flex-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium focus:border-accent focus:outline-none transition-colors
                    ${getSmartValue("status")
                      ? (STATUS_COLORS[getSmartValue("status")] ?? "text-text-secondary bg-surface-overlay")
                      : "text-text-muted bg-surface-overlay"}`}
                >
                  <option value="">— unset —</option>
                  {STATUS_VALUES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </PropRow>

              {/* Date */}
              <PropRow label="date">
                <div className="flex flex-1 items-center gap-1">
                  <input
                    type="date"
                    value={getSmartValue("date")}
                    onChange={(e) => setSmartValue("date", e.target.value)}
                    className="flex-1 rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-[10px] text-text-secondary focus:border-accent focus:outline-none"
                  />
                  {getSmartValue("date") && (
                    <button
                      onClick={() => setSmartValue("date", "")}
                      title="Clear date"
                      className="shrink-0 rounded p-0.5 text-text-muted hover:text-red-400 transition-colors"
                    >
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              </PropRow>

              {/* Parent — read-only, auto-derived from containing folder */}
              <PropRow label="parent">
                {autoParent ? (
                  <span
                    title="Automatically derived from the folder this note is in. Use 'Visual Context' in the sidebar to highlight it in the file tree."
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-[10px] text-text-secondary"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                      <path d="M3 3h6l2 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>
                    </svg>
                    {autoParent}
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted/40 italic">root of vault</span>
                )}
              </PropRow>

              {/* Aliases */}
              <PropRow label="aliases">
                <div className="flex-1 space-y-0.5">
                  <input
                    type="text"
                    value={getSmartValue("aliases")}
                    onChange={(e) => setSmartValue("aliases", e.target.value)}
                    placeholder="alt name, short name…"
                    title="Comma-separated alternative names. These are matched when you type [[ in the editor."
                    className="w-full rounded border border-border bg-surface-overlay px-1.5 py-0.5 text-[10px] text-text-secondary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                  />
                  <p className="text-[9px] text-text-muted/50 leading-tight">
                    Comma-separated. Searched by [[ wikilink autocomplete.
                  </p>
                </div>
              </PropRow>

            </div>
          </Row>

          {/* ── Tags ────────────────────────────────────────────────────── */}
          <Row label="Tags">
            <div className="flex flex-wrap items-center gap-1">
              {tags.map((tag, i) =>
                editingTagIdx === i ? (
                  <input key={i} ref={tagInputRef} value={draftTag}
                    onChange={(e) => setDraftTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitTagEdit();
                      if (e.key === "Escape") { setEditingTagIdx(null); setDraftTag(""); }
                    }}
                    onBlur={commitTagEdit}
                    className="rounded border border-accent bg-surface-base px-2 py-0.5 text-[10px] font-medium text-accent focus:outline-none w-24"
                  />
                ) : (
                  <span key={i} className="group flex items-center gap-0.5 rounded-full bg-accent/10 pl-2 pr-1 py-0.5">
                    <button onClick={() => { setEditingTagIdx(i); setDraftTag(tag); }}
                      className="text-[10px] font-medium text-accent hover:text-accent transition-colors">
                      #{tag}
                    </button>
                    <button onClick={() => removeTag(i)} title="Remove tag"
                      className="rounded-full p-0.5 text-accent/50 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </span>
                )
              )}

              {/* Inline hashtags from body (read-only) */}
              {body.inlineTags.filter((t) => !tags.includes(t)).map((t) => (
                <span key={`body-${t}`} title="Found in body (read-only)"
                  className="rounded-full border border-dashed border-accent/30 px-2 py-0.5 text-[10px] text-accent/50">
                  #{t}
                </span>
              ))}

              {addingTag ? (
                <input ref={newTagInputRef} value={newTagDraft} placeholder="tag name"
                  onChange={(e) => setNewTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitNewTag();
                    if (e.key === "Escape") { setAddingTag(false); setNewTagDraft(""); }
                  }}
                  onBlur={commitNewTag}
                  className="rounded border border-border bg-surface-base px-2 py-0.5 text-[10px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none w-24"
                />
              ) : (
                <button onClick={() => setAddingTag(true)}
                  className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-text-muted hover:border-accent hover:text-accent transition-colors">
                  + tag
                </button>
              )}
            </div>
          </Row>

          {/* ── Generic frontmatter fields (smart keys excluded) ─────── */}
          {(genericFields.length > 0 || addingField) && (
            <Row label="Fields">
              <div className="space-y-1">
                {genericFields.map(([k, v]) => {
                  // Map back to the real index in `fields` for editing/removal
                  const realIdx = fields.findIndex(([fk]) => fk === k);
                  return (
                    <div key={k} className="group flex items-center gap-1.5">
                      {/* Key */}
                      {editingField?.idx === realIdx && editingField.part === "key" ? (
                        <input value={draftField}
                          onChange={(e) => setDraftField(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commitFieldEdit(); }
                            if (e.key === "Escape") { setEditingField(null); setDraftField(""); }
                          }}
                          onBlur={commitFieldEdit} autoFocus
                          className="w-20 shrink-0 rounded border border-accent bg-surface-base px-1.5 py-0.5 text-[10px] font-medium text-text-secondary focus:outline-none"
                        />
                      ) : (
                        <button onClick={() => { setEditingField({ idx: realIdx, part: "key" }); setDraftField(k); }}
                          className="w-20 shrink-0 truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium text-text-muted hover:bg-surface-overlay hover:text-text-secondary transition-colors">
                          {k}
                        </button>
                      )}
                      <span className="text-text-muted text-[10px]">:</span>
                      {/* Value */}
                      {editingField?.idx === realIdx && editingField.part === "val" ? (
                        <input value={draftField}
                          onChange={(e) => setDraftField(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitFieldEdit();
                            if (e.key === "Escape") { setEditingField(null); setDraftField(""); }
                          }}
                          onBlur={commitFieldEdit} autoFocus
                          className="flex-1 rounded border border-accent bg-surface-base px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
                        />
                      ) : (
                        <button onClick={() => { setEditingField({ idx: realIdx, part: "val" }); setDraftField(v); }}
                          className="flex-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] text-text-secondary hover:bg-surface-overlay hover:text-text-primary transition-colors">
                          {v || <span className="italic text-text-muted/60">empty</span>}
                        </button>
                      )}
                      <button onClick={() => removeField(realIdx)}
                        className="shrink-0 rounded p-0.5 text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  );
                })}

                {/* Add field row */}
                {addingField && (
                  <div className="flex items-center gap-1.5">
                    <input ref={newKeyInputRef} value={newKey} placeholder="key"
                      onChange={(e) => setNewKey(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") { e.preventDefault(); (e.currentTarget.nextElementSibling?.nextElementSibling as HTMLInputElement)?.focus(); }
                        if (e.key === "Escape") { setAddingField(false); setNewKey(""); setNewVal(""); }
                      }}
                      className="w-20 shrink-0 rounded border border-border bg-surface-base px-1.5 py-0.5 text-[10px] font-medium text-text-secondary placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                    <span className="text-text-muted text-[10px]">:</span>
                    <input value={newVal} placeholder="value"
                      onChange={(e) => setNewVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitNewField();
                        if (e.key === "Escape") { setAddingField(false); setNewKey(""); setNewVal(""); }
                      }}
                      onBlur={commitNewField}
                      className="flex-1 rounded border border-border bg-surface-base px-1.5 py-0.5 text-[10px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </Row>
          )}

          <button onClick={() => setAddingField(true)}
            className="text-[10px] text-text-muted hover:text-accent transition-colors">
            + Add field
          </button>

          {/* ── Links (read-only) ──────────────────────────────────────── */}
          {body.links.length > 0 && (
            <Row label="Links">
              <div className="flex flex-wrap gap-1">
                {body.links.map((link) => (
                  <button key={link} onClick={() => onLinkClick?.(link)} title={`Open [[${link}]]`}
                    className="rounded border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-secondary hover:text-accent hover:border-accent transition-colors">
                    [[{link}]]
                  </button>
                ))}
              </div>
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small shared layout helpers ───────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-text-muted">{label}</p>
      {children}
    </div>
  );
}

/** Two-column row used inside the Properties section: fixed label + flex control. */
function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-medium text-text-muted">{label}</span>
      {children}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="opacity-0 group-hover:opacity-60 transition-opacity">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}
