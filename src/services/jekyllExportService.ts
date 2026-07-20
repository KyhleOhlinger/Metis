import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/store/useStore";
import { usePersonaStore } from "@/store/usePersonaStore";
import {
  convertNoteToJekyll,
  type JekyllConvertResult,
} from "@/utils/jekyllConverter";
import { normalizePosixPath } from "@/utils/paths";

export interface JekyllExportInput {
  notePath: string;
  content?: string;
  title?: string;
  slug?: string;
  date?: string;
  categories?: string[];
  blogRoot?: string;
  imageSubfolder?: string;
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function jekyllSettings() {
  const s = usePersonaStore.getState().settings;
  return {
    blogRoot: s.jekyllBlogRoot?.trim() ?? "",
    author: s.jekyllAuthor?.trim() ?? "",
    categories: s.jekyllDefaultCategories ?? [],
    imageSubfolder: s.jekyllImageSubfolder?.trim() ?? "",
    siteUrl: s.jekyllSiteUrl?.trim() ?? "",
    description: s.jekyllDescription?.trim() ?? "",
  };
}

export function previewJekyllConversion(input: JekyllExportInput): JekyllConvertResult {
  const { vaultPath, assetIndex, noteIndex, activeFilePath, activeFileContent } =
    useStore.getState();
  if (!vaultPath) throw new Error("Open a vault before converting.");

  const settings = jekyllSettings();
  const content =
    input.content ??
    (input.notePath === activeFilePath && activeFileContent != null
      ? activeFileContent
      : null);

  if (content == null) {
    throw new Error("Note content is required for preview.");
  }

  return convertNoteToJekyll(content, {
    title: input.title,
    slug: input.slug,
    date: input.date,
    author: settings.author,
    categories: input.categories ?? settings.categories,
    description: settings.description,
    imageSubfolder: input.imageSubfolder ?? settings.imageSubfolder,
    siteUrl: settings.siteUrl,
    notePath: input.notePath,
    vaultPath,
    assetIndex,
    noteIndex,
  });
}

export async function loadNoteContentForJekyll(notePath: string): Promise<string> {
  const { activeFilePath, activeFileContent } = useStore.getState();
  if (notePath === activeFilePath && activeFileContent != null) {
    return activeFileContent;
  }
  return invoke<string>("get_file_content", { path: notePath });
}

export async function exportNoteToJekyll(input: JekyllExportInput): Promise<string> {
  const { vaultPath } = useStore.getState();
  if (!vaultPath) throw new Error("Open a vault before exporting.");

  const settings = jekyllSettings();
  const blogRoot = (input.blogRoot ?? settings.blogRoot).trim();
  if (!blogRoot) throw new Error("Choose a Jekyll blog root folder in settings or the export dialog.");

  const content = input.content ?? (await loadNoteContentForJekyll(input.notePath));
  const converted = convertNoteToJekyll(content, {
    title: input.title,
    slug: input.slug,
    date: input.date,
    author: settings.author,
    categories: input.categories ?? settings.categories,
    description: settings.description,
    imageSubfolder: input.imageSubfolder ?? settings.imageSubfolder,
    siteUrl: settings.siteUrl,
    notePath: input.notePath,
    vaultPath,
    assetIndex: useStore.getState().assetIndex,
    noteIndex: useStore.getState().noteIndex,
  });

  const postsDir = normalizePosixPath(`${blogRoot}/_posts`);
  const postPath = `${postsDir}/${converted.filename}`;

  if (converted.imageCopies.length > 0) {
    const sub = (input.imageSubfolder ?? settings.imageSubfolder).replace(/^\/+|\/+$/g, "");
    const imageDest = sub
      ? normalizePosixPath(`${blogRoot}/assets/img/${sub}`)
      : normalizePosixPath(`${blogRoot}/assets/img`);
    await invoke<number>("copy_files_to_folder", {
      sourcePaths: converted.imageCopies.map((img) => img.sourceAbsPath),
      destDir: imageDest,
    });
  }

  await invoke("write_export_bytes", {
    path: postPath,
    dataBase64: textToBase64(converted.content),
  });

  if (!settings.blogRoot) {
    usePersonaStore.getState().updateSettings({ jekyllBlogRoot: blogRoot });
  }

  return postPath;
}

export async function pickJekyllBlogRoot(): Promise<string | null> {
  const picked = await invoke<string | null>("pick_folder");
  return picked;
}
