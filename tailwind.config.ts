import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Metis design system — dark-first
        surface: {
          base: "#16171a",
          raised: "#1e1f24",
          overlay: "#26272d",
        },
        border: "#2d2e35",
        accent: {
          DEFAULT: "#7c3aed",
          hover: "#6d28d9",
          muted: "#4c1d95",
        },
        text: {
          primary: "#e2e8f0",
          secondary: "#94a3b8",
          muted: "#64748b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Fira Code", "Cascadia Code", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
