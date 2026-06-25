import { invoke } from "@tauri-apps/api/core";
import html2pdf from "html2pdf.js";
import type { NoteMetadata } from "@/store/useStore";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import type { BgPreset } from "@/components/editor/bgPresets";
import { resolveBgPreset } from "@/components/editor/bgPresets";
import { buildNotePreviewHtml } from "@/utils/buildNotePreviewHtml";
import { EXPORT_CHAPTER_CSS } from "@/utils/exportPreviewStyles";
import { isPathWithinVault, normalizePosixPath } from "@/utils/paths";

export type PdfExportScope = "file" | "folder" | "vault";

type VaultImageBase64 = { data_base64: string; mime_type: string };

export type PdfExportProgress = {
  phase: "loading" | "rendering" | "writing";
  current: number;
  total: number;
  label: string;
};

type Html2PdfOpts = {
  margin?: number | [number, number] | [number, number, number, number];
  filename?: string;
  image?: { type?: "jpeg" | "png" | "webp"; quality?: number };
  html2canvas?: Record<string, unknown>;
  jsPDF?: { unit?: string; format?: string; orientation?: "portrait" | "landscape" };
  pagebreak?: { mode?: string | string[]; before?: string | string[]; after?: string | string[] };
};

function noteDisplayName(note: NoteMetadata): string {
  return note.name.replace(/\.md$/i, "") || note.name;
}

function defaultExportName(scope: PdfExportScope, hint?: string): string {
  if (scope === "file" && hint) {
    return `${hint.replace(/\.md$/i, "")}.pdf`;
  }
  if (scope === "folder" && hint) {
    const base = hint.split("/").pop() ?? "folder";
    return `${base}-export.pdf`;
  }
  const vault = useStore.getState().vaultPath;
  const vaultName = vault?.split("/").pop() ?? "vault";
  return `${vaultName}-export.pdf`;
}

function notesForFolder(noteIndex: NoteMetadata[], folderPath: string): NoteMetadata[] {
  const folder = normalizePosixPath(folderPath);
  const prefix = `${folder}/`;
  return noteIndex
    .filter((n) => n.path.startsWith(prefix) || normalizePosixPath(n.path) === folder)
    .filter((n) => n.path.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function exportBgPreset(): BgPreset {
  const id = usePersonaStore.getState().settings.editorBgPresetId;
  return resolveBgPreset(id);
}

async function readNoteContents(
  notes: NoteMetadata[],
  onProgress?: (p: PdfExportProgress) => void,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const paths = notes.map((n) => n.path);

  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    onProgress?.({
      phase: "loading",
      current: Math.min(i + batch.length, paths.length),
      total: paths.length,
      label: "Reading notes…",
    });
    const bodies = await invoke<string[]>("get_file_contents_batch", { paths: batch });
    batch.forEach((path, idx) => {
      out.set(path, bodies[idx] ?? "");
    });
  }
  return out;
}

/** Replace vault image refs with inline data URLs for offline PDF rendering. */
async function inlineExportImages(html: string): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return html;

  const images = root.querySelectorAll<HTMLImageElement>("img[data-export-abs-path]");
  for (const img of images) {
    const absPath = img.getAttribute("data-export-abs-path");
    if (!absPath) continue;
    try {
      const { data_base64, mime_type } = await invoke<VaultImageBase64>(
        "read_vault_image_base64",
        { path: absPath },
      );
      img.src = `data:${mime_type};base64,${data_base64}`;
      img.removeAttribute("data-export-abs-path");
    } catch {
      img.alt = img.alt || "Image unavailable";
      img.removeAttribute("src");
    }
  }
  return root.innerHTML;
}

function buildExportHost(
  chapters: { title: string; html: string }[],
  preset: BgPreset,
  showChapterTitles = chapters.length > 1,
): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-color-scheme", preset.isDark ? "dark" : "light");
  host.style.cssText = [
    "position:fixed",
    "left:-12000px",
    "top:0",
    "width:720px",
    `background:${preset.bg}`,
    `color:${preset.fg}`,
  ].join(";");

  const style = document.createElement("style");
  style.textContent = EXPORT_CHAPTER_CSS;
  host.appendChild(style);

  const prose = document.createElement("div");
  prose.className = "preview-prose";
  prose.style.backgroundColor = preset.bg;
  prose.style.color = preset.fg;
  prose.style.padding = "1.5rem 3rem 4rem";
  prose.style.minHeight = "100%";

  chapters.forEach((ch, i) => {
    const section = document.createElement("section");
    section.className =
      i > 0 ? "export-chapter export-chapter-break" : "export-chapter";

    if (showChapterTitles) {
      const title = document.createElement("h2");
      title.className = "export-chapter-title";
      title.textContent = ch.title;
      section.appendChild(title);
    }

    const body = document.createElement("div");
    body.innerHTML = ch.html;
    section.appendChild(body);
    prose.appendChild(section);
  });

  host.appendChild(prose);
  return host;
}

function pdfOptions(preset: BgPreset): Html2PdfOpts {
  return {
    margin: [0.45, 0.55, 0.55, 0.55] as [number, number, number, number],
    filename: "export.pdf",
    image: { type: "jpeg", quality: 0.92 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: preset.bg,
    },
    jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
    pagebreak: {
      mode: ["css", "legacy"],
      before: ".export-chapter-break",
    },
  };
}

async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const merged = await PDFDocument.create();
  for (const blob of blobs) {
    const src = await PDFDocument.load(await blob.arrayBuffer());
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  const bytes = await merged.save();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

async function renderChaptersToPdf(
  chapters: { title: string; html: string }[],
  preset: BgPreset,
): Promise<Blob> {
  if (chapters.length === 1) {
    const host = buildExportHost(chapters, preset, false);
    document.body.appendChild(host);
    try {
      return await htmlToPdfBlob(host, preset);
    } finally {
      document.body.removeChild(host);
    }
  }

  const blobs: Blob[] = [];
  for (const chapter of chapters) {
    const host = buildExportHost([chapter], preset, true);
    document.body.appendChild(host);
    try {
      blobs.push(await htmlToPdfBlob(host, preset));
    } finally {
      document.body.removeChild(host);
    }
  }
  return mergePdfBlobs(blobs);
}

async function htmlToPdfBlob(host: HTMLElement, preset: BgPreset): Promise<Blob> {
  const target = host.querySelector(".preview-prose") ?? host;
  return (await html2pdf()
    .set(pdfOptions(preset))
    .from(target as HTMLElement)
    .outputPdf("blob")) as Blob;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function exportNotesToPdf(options: {
  scope: PdfExportScope;
  filePath?: string;
  folderPath?: string;
  onProgress?: (p: PdfExportProgress) => void;
}): Promise<string | null> {
  const { vaultPath, noteIndex, assetIndex, activeFilePath, activeFileContent } =
    useStore.getState();
  if (!vaultPath) throw new Error("Open a vault before exporting.");

  const preset = exportBgPreset();

  let notes: NoteMetadata[] = [];
  let defaultName = "export.pdf";
  const contentOverrides = new Map<string, string>();

  if (options.scope === "file") {
    const path = options.filePath ?? activeFilePath;
    if (!path?.toLowerCase().endsWith(".md")) {
      throw new Error("Select a markdown note to export.");
    }
    const meta = noteIndex.find((n) => n.path === path);
    notes = meta ? [meta] : [{ name: path.split("/").pop() ?? "note.md", path }];
    if (path === activeFilePath && activeFileContent != null) {
      contentOverrides.set(path, activeFileContent);
    }
    defaultName = defaultExportName("file", notes[0].name);
  } else if (options.scope === "folder") {
    const folderPath = options.folderPath;
    if (!folderPath) throw new Error("Choose a folder to export.");
    if (!isPathWithinVault(normalizePosixPath(folderPath), vaultPath)) {
      throw new Error("Folder must be inside the open vault.");
    }
    notes = notesForFolder(noteIndex, folderPath);
    if (!notes.length) throw new Error("No markdown notes found in that folder.");
    defaultName = defaultExportName("folder", folderPath.slice(vaultPath.length + 1));
  } else {
    notes = noteIndex
      .filter((n) => n.path.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (!notes.length) throw new Error("No markdown notes in this vault.");
    defaultName = defaultExportName("vault");
    if (activeFilePath && activeFileContent != null) {
      contentOverrides.set(activeFilePath, activeFileContent);
    }
  }

  const savePath = await invoke<string | null>("pick_save_path", {
    defaultName,
    extension: "pdf",
  });
  if (!savePath) return null;

  const bodies = await readNoteContents(notes, options.onProgress);
  for (const [path, content] of contentOverrides) {
    bodies.set(path, content);
  }

  const chapters: { title: string; html: string }[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    options.onProgress?.({
      phase: "rendering",
      current: i + 1,
      total: notes.length,
      label: noteDisplayName(note),
    });
    const content = bodies.get(note.path) ?? "";
    let html = buildNotePreviewHtml({
      content,
      vaultPath,
      filePath: note.path,
      assetIndex,
    });
    html = await inlineExportImages(html);
    const rel = note.path.startsWith(`${vaultPath}/`)
      ? note.path.slice(vaultPath.length + 1)
      : note.name;
    chapters.push({ title: rel.replace(/\.md$/i, ""), html });
  }

  options.onProgress?.({
    phase: "rendering",
    current: notes.length,
    total: notes.length,
    label: "Building PDF…",
  });

  const pdfBlob = await renderChaptersToPdf(chapters, preset);

  options.onProgress?.({
    phase: "writing",
    current: 1,
    total: 1,
    label: "Saving…",
  });

  await invoke("write_export_bytes", {
    path: savePath,
    dataBase64: await blobToBase64(pdfBlob),
  });

  return savePath;
}
