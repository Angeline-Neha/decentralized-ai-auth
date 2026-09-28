/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        console: {
          bg: "#0f1419",
          panel: "#1a2332",
          border: "#2d3a4f",
          muted: "#8b9cb3",
        },
        status: {
          ok: "#22c55e",
          warn: "#f59e0b",
          bad: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
