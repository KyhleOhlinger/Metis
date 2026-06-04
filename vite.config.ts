import path from "node:path";
import type { ProxyOptions } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Drop browser-only headers so proxied calls resemble server-side / Tauri traffic (helps Gemini API keys). */
const stripClientOriginHeaders: NonNullable<ProxyOptions["configure"]> = (proxy) => {
  proxy.on("proxyReq", (proxyReq) => {
    proxyReq.removeHeader("referer");
    proxyReq.removeHeader("origin");
  });
};

// Tauri expects a fixed port and disables the Vite overlay so Tauri's error
// handling can take over instead.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Prevent Vite from obscuring Rust compile errors
  clearScreen: false,
  build: {
    /** Tauri’s WebView2 / WKWebView targets modern ECMAScript; avoids excessive downlevel transforms. */
    target: "es2022",
    // CodeMirror + Lezer grammars are inherently large; 500 kB default is too
    // strict for a desktop shell that loads from disk, not over HTTP.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        /**
         * Split heavy vendors so no single chunk trips Rollup's 500 kB warning.
         * (@codemirror/language-data alone pulls many Lezer grammars.)
         */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/scheduler")) {
            return "react-vendor";
          }
          // Third-party language grammars — bulk of editor size (~1.5 MB minified).
          if (id.includes("node_modules/@lezer")) {
            return "lezer-grammars";
          }
          if (id.includes("@codemirror/language-data")) {
            return "codemirror-languages";
          }
          if (
            id.includes("@codemirror") ||
            id.includes("/codemirror/") ||
            id.includes("node_modules/codemirror")
          ) {
            return "codemirror";
          }
          if (id.includes("node_modules/openai")) {
            return "openai";
          }
          if (id.includes("marked") || id.includes("dompurify")) {
            return "markdown";
          }
          if (id.includes("lucide-react")) {
            return "lucide";
          }
          if (id.includes("@tauri-apps")) {
            return "tauri";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Tell Vite to ignore watching src-tauri (Rust rebuilds are handled by Tauri)
      ignored: ["**/src-tauri/**"],
    },

    // ── AI provider dev proxy ─────────────────────────────────────────────
    // In development the webview loads from http://localhost:1420 — a plain
    // HTTP origin — so outbound fetch calls to AI APIs hit standard browser
    // CORS rules and are often blocked.  In production the app runs under the
    // tauri:// custom protocol which bypasses these constraints.
    //
    // These proxy rules forward /api-proxy/<provider>/... to the real API
    // host via the Vite dev server (Node.js), which is not subject to CORS.
    // The corresponding base URLs are switched in aiService.ts when
    // import.meta.env.DEV is true.
    proxy: {
      "/api-proxy/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/openai/, ""),
        configure: stripClientOriginHeaders,
      },
      "/api-proxy/groq": {
        target: "https://api.groq.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/groq/, ""),
        configure: stripClientOriginHeaders,
      },
      "/api-proxy/gemini": {
        target: "https://generativelanguage.googleapis.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/gemini/, ""),
        configure: stripClientOriginHeaders,
      },
      /** Native v1beta REST (generateContent) — used when OpenAI-compat path hits bogus 429s in the browser. */
      "/api-proxy/gemini-native": {
        target: "https://generativelanguage.googleapis.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/gemini-native/, ""),
        configure: stripClientOriginHeaders,
      },
      "/api-proxy/perplexity": {
        target: "https://api.perplexity.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy\/perplexity/, ""),
        configure: stripClientOriginHeaders,
      },
    },
  },
});
