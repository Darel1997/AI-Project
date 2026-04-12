/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0d1117",
          raised: "#161b22",
          overlay: "#1c2128",
          border: "#30363d",
        },
        accent: {
          DEFAULT: "#58a6ff",
          hover: "#79c0ff",
          muted: "#388bfd",
        },
        success: "#3fb950",
        warning: "#d29922",
        danger: "#f85149",
        text: {
          primary: "#e6edf3",
          secondary: "#8b949e",
          muted: "#6e7681",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
    },
  },
  plugins: [],
};
