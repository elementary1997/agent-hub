/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Inspired by easySTT's gradient palette — feels at home next to it.
        bg: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          card: "var(--bg-card)",
          elev: "var(--bg-elev)",
        },
        border: {
          subtle: "var(--border-subtle)",
          default: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          muted: "var(--accent-muted)",
        },
        success: "var(--success)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        muted: "var(--muted)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,.4), 0 8px 32px -4px rgba(124,92,255,.25)",
        card: "0 1px 0 rgba(255,255,255,.04) inset, 0 8px 32px -16px rgba(0,0,0,.6)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulse: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: ".5" },
        },
      },
      animation: {
        "fade-up": "fade-up .25s ease-out",
        "pulse-slow": "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
