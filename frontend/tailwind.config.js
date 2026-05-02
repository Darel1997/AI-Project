/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Surfaces — deeper, warmer, with more separation between layers
        surface: {
          DEFAULT: "#07080d",       // near-black base, warmer than before
          raised:  "#0e1017",       // cards, panels
          overlay: "#161922",       // hover / nested surfaces
          border:  "#20242f",       // subtle border
          hover:   "#1a1e29",
          sunken:  "#05060a",       // deepest layer — for modals on modals
        },

        // ── Accent — signature color with vibrant depth
        accent: {
          DEFAULT: "#7c6bff",       // vibrant violet-blue, more "alive" than plain blue
          hover:   "#9488ff",
          muted:   "#6151f0",
          subtle:  "rgba(124, 107, 255, 0.12)",
          glow:    "rgba(124, 107, 255, 0.35)",
        },

        // ── Secondary accent for depth (used sparingly: callouts, shine)
        violet:  { DEFAULT: "#b794f4", subtle: "rgba(183, 148, 244, 0.1)" },
        cyan:    { DEFAULT: "#22d3ee", subtle: "rgba(34, 211, 238, 0.1)" },
        emerald: { DEFAULT: "#34d399", subtle: "rgba(52, 211, 153, 0.1)" },
        amber:   { DEFAULT: "#fbbf24", subtle: "rgba(251, 191, 36, 0.1)" },
        rose:    { DEFAULT: "#fb7185", subtle: "rgba(251, 113, 133, 0.1)" },

        // ── Semantic states
        success: { DEFAULT: "#34d399", muted: "rgba(52, 211, 153, 0.12)" },
        warning: { DEFAULT: "#fbbf24", muted: "rgba(251, 191, 36, 0.12)" },
        danger:  { DEFAULT: "#f87171", muted: "rgba(248, 113, 113, 0.12)" },

        // ── Text — tuned for new deeper background
        text: {
          primary:   "#f5f6f9",      // 17:1 contrast on #07080d — AAA
          secondary: "#b0b6c3",      // 9.2:1 — AAA
          muted:     "#7a8190",      // 5.6:1 — AA normal
          faint:     "#50566a",      // decorative only
        },
      },

      fontFamily: {
        sans: ['"Inter"', '"IBM Plex Sans"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "ui-monospace", "monospace"],
        display: ['"Inter"', '"IBM Plex Sans"', "system-ui", "sans-serif"],
      },

      fontSize: {
        // Fluid type — scales smoothly, tighter tracking for display sizes
        "display-1": ["clamp(3rem, 5.5vw + 1rem, 5.5rem)",    { lineHeight: "1.02", letterSpacing: "-0.035em", fontWeight: "700" }],
        "display-2": ["clamp(2.25rem, 3.5vw + 1rem, 3.75rem)",{ lineHeight: "1.06", letterSpacing: "-0.03em",  fontWeight: "700" }],
        "display-3": ["clamp(1.75rem, 2.5vw + 0.5rem, 2.5rem)",{ lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "600" }],
      },

      boxShadow: {
        // Softer, more atmospheric shadows
        "glow":       "0 0 60px -15px rgba(124, 107, 255, 0.5)",
        "glow-sm":    "0 0 30px -10px rgba(124, 107, 255, 0.35)",
        "glow-lg":    "0 0 120px -30px rgba(124, 107, 255, 0.6)",
        "card":       "0 1px 2px rgba(0,0,0,0.2), 0 4px 12px -4px rgba(0,0,0,0.3)",
        "card-hover": "0 2px 6px rgba(0,0,0,0.25), 0 16px 40px -10px rgba(0,0,0,0.5)",
        "card-elevated": "0 4px 16px rgba(0,0,0,0.3), 0 24px 60px -15px rgba(0,0,0,0.6)",
        "inset-soft": "inset 0 1px 0 0 rgba(255,255,255,0.05)",
        "inset-border": "inset 0 0 0 1px rgba(255,255,255,0.06)",
      },

      backgroundImage: {
        // Fine grid — subtle tech feel without feeling sterile
        "grid-pattern":
          "linear-gradient(to right, rgba(124,107,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(124,107,255,0.06) 1px, transparent 1px)",

        // Signature hero gradient — aurora-like
        "hero-gradient":
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124, 107, 255, 0.22), transparent 65%)",

        // Multi-stop aurora — layered color for depth
        "aurora":
          "radial-gradient(ellipse 100% 80% at 20% 0%, rgba(124, 107, 255, 0.18), transparent 60%), radial-gradient(ellipse 80% 60% at 80% 20%, rgba(34, 211, 238, 0.1), transparent 50%), radial-gradient(ellipse 70% 50% at 50% 100%, rgba(183, 148, 244, 0.12), transparent 60%)",

        // Mesh background — for app chrome ambient feel
        "mesh":
          "radial-gradient(at 0% 0%, rgba(124, 107, 255, 0.08) 0%, transparent 50%), radial-gradient(at 100% 0%, rgba(34, 211, 238, 0.05) 0%, transparent 50%), radial-gradient(at 50% 100%, rgba(183, 148, 244, 0.06) 0%, transparent 50%)",

        // Shine — for interactive hover states
        "shine":
          "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)",

        // Noise overlay — adds texture, combats "flat" feel
        "noise":
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",

        // Conic for accent elements (custom loaders, highlighted cards)
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, rgba(124,107,255,0.4), rgba(34,211,238,0.4), rgba(183,148,244,0.4), rgba(124,107,255,0.4))",
      },

      animation: {
        "fade-in":     "fadeIn 0.4s ease-out",
        "fade-in-slow":"fadeIn 0.8s ease-out",
        "slide-up":    "slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down":  "slideDown 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in":    "scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
        "shimmer":     "shimmer 2.5s linear infinite",
        "pulse-glow":  "pulseGlow 3s ease-in-out infinite",
        "float":       "float 6s ease-in-out infinite",
        "aurora":      "aurora 12s ease infinite",
        "spin-slow":   "spin 20s linear infinite",
        "breathe":     "breathe 4s ease-in-out infinite",
      },

      keyframes: {
        fadeIn:    { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp:   { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        slideDown: { from: { opacity: "0", transform: "translateY(-16px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        scaleIn:   { from: { opacity: "0", transform: "scale(0.96)" }, to: { opacity: "1", transform: "scale(1)" } },
        shimmer:   { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        pulseGlow: { "0%,100%": { boxShadow: "0 0 20px -8px rgba(124,107,255,0.3)" }, "50%": { boxShadow: "0 0 60px -8px rgba(124,107,255,0.7)" } },
        float:     { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        aurora:    { "0%,100%": { transform: "translate(0,0) rotate(0)" }, "50%": { transform: "translate(-30px,20px) rotate(2deg)" } },
        breathe:   { "0%,100%": { opacity: "0.7", transform: "scale(1)" }, "50%": { opacity: "1", transform: "scale(1.02)" } },
      },

      transitionTimingFunction: {
        "smooth": "cubic-bezier(0.16, 1, 0.3, 1)",
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },

      backdropBlur: {
        "xs": "2px",
      },
    },
  },
  plugins: [],
};
