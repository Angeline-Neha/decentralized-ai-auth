/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Schibsted Grotesk", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Surfaces
        paper: "#F3F1F0",
        card: "#FBFAF9",
        sunk: "#EAE5E4",
        line: "#DCD3D2",
        // Text
        ink: "#1E1517",
        mute: "#75676A",
        // Brand: oxblood, darkest to lightest
        ox: {
          50: "#F6EAE9",
          100: "#ECD5D3",
          300: "#B96A6D",
          500: "#7A1A1F",
          600: "#5A0E13",
          700: "#440A0E",
          800: "#33070A",
          900: "#230507",
        },
        // Signals (kept distinct from the brand red so a denial never looks like a normal button)
        ok: "#2C5A45",
        warn: "#9A5B0C",
        bad: "#C8202D",
      },
      keyframes: {
        draw: { from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } },
        enter: { from: { opacity: "0", transform: "translateY(-6px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        draw: "draw .9s ease-out both",
        enter: "enter .35s ease-out both",
      },
    },
  },
  plugins: [],
};
