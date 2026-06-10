import { marked } from "marked";
/** ~40 common languages — avoids pulling the full highlight.js language pack into the app chunk. */
import hljs from "highlight.js/lib/common";

/** Common fence language tags → highlight.js ids. */
const LANG_ALIASES: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  objc: "objectivec",
  docker: "dockerfile",
  dockerfile: "dockerfile",
};

function resolveLanguage(lang: string | undefined): string | undefined {
  const raw = lang?.trim().toLowerCase();
  if (!raw) return undefined;
  if (hljs.getLanguage(raw)) return raw;
  const aliased = LANG_ALIASES[raw];
  if (aliased && hljs.getLanguage(aliased)) return aliased;
  return undefined;
}

let configured = false;

function ensureMarkedHighlight(): void {
  if (configured) return;
  configured = true;

  marked.use({
    renderer: {
      code({ text, lang }) {
        const language = resolveLanguage(lang);
        if (language) {
          const highlighted = hljs.highlight(text, { language }).value;
          return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
        }
        const auto = hljs.highlightAuto(text);
        const langClass = auto.language ? ` language-${auto.language}` : "";
        return `<pre><code class="hljs${langClass}">${auto.value}</code></pre>`;
      },
    },
  });
}

export type MarkedParseOptions = {
  gfm?: boolean;
  breaks?: boolean;
};

/** marked.parse with fenced-code syntax highlighting for Visual/planner previews. */
export function parseMarkedWithHighlight(
  markdown: string,
  options: MarkedParseOptions = {},
): string {
  ensureMarkedHighlight();
  return marked.parse(markdown, {
    gfm: options.gfm ?? true,
    breaks: options.breaks ?? false,
  }) as string;
}
