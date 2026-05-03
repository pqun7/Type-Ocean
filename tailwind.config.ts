import { heroui } from "@heroui/theme";
import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";
import plugin from "tailwindcss/plugin";
const colors = require("tailwindcss/colors");
const {
  default: flattenColorPalette,
} = require("tailwindcss/lib/util/flattenColorPalette");

export default {
  darkMode: ["class", "class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/components/progress.js",
  ],
  theme: {
    extend: {
      animation: {
        first: "moveVertical 30s ease infinite",
        second: "moveInCircle 20s reverse infinite",
        third: "moveInCircle 40s linear infinite",
        fourth: "moveHorizontal 40s ease infinite",
        fifth: "moveInCircle 20s ease infinite",
        shimmer: "shimmer 2s linear infinite",
        softPulse: "softPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "countdown-pop": "countdown-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        float: "float 8s ease-in-out infinite",
        "float-delayed": "float-delayed 10s ease-in-out infinite",
        "pulse-slow": "pulse-slow 6s ease-in-out infinite",
        bubble: "bubble 15s infinite ease-in-out",
        wave: "wave 20s linear infinite",
        "wave-opacity": "wave-opacity 12s ease-in-out infinite",
      },
      dropShadow: {
        glow: [
          "0 0px 20px rgba(255,255, 255, 0.35)",
          "0 0px 65px rgba(255, 255,255, 0.2)",
        ],
        messageGlow: ["0 0 8px rgba(59, 130, 246, 0.2)"],
      },
      keyframes: {
        "wave-opacity": {
          "0%, 100%": {
            transform: "translateX(0) scaleY(1)",
            opacity: "0.4",
          },
          "50%": {
            transform: "translateX(-25%) scaleY(0.9)",
            opacity: "0.6",
          },
        },
        moveHorizontal: {
          "0%": {
            transform: "translateX(-50%) translateY(-10%)",
          },
          "50%": {
            transform: "translateX(50%) translateY(10%)",
          },
          "100%": {
            transform: "translateX(-50%) translateY(-10%)",
          },
        },
        bubble: {
          "0%, 100%": {
            transform: "translateY(0) scale(1)",
          },
          "50%": {
            transform: "translateY(-100px) scale(1.2)",
          },
        },
        wave: {
          "0%": {
            transform: "translateX(0)",
          },
          "100%": {
            transform: "translateX(-50%)",
          },
        },
        moveInCircle: {
          "0%": {
            transform: "rotate(0deg)",
          },
          "50%": {
            transform: "rotate(180deg)",
          },
          "100%": {
            transform: "rotate(360deg)",
          },
        },
        moveVertical: {
          "0%": {
            transform: "translateY(-50%)",
          },
          "50%": {
            transform: "translateY(50%)",
          },
          "100%": {
            transform: "translateY(-50%)",
          },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "countdown-pop": {
          "0%": { transform: "scale(0.45)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        softPulse: {
          "0%, 100%": {
            opacity: "0.9",
            filter: "drop-shadow(0 0 2px rgba(0, 0, 0, 0.1))",
          },
          "50%": {
            opacity: "1",
            filter: "drop-shadow(0 0 6px rgba(0, 0, 0, 0.15))",
          },
        },
        float: {
          "0%, 100%": {
            transform: "translateY(0) scale(1)",
          },
          "50%": {
            transform: "translateY(-20px) scale(1.05)",
          },
        },
        "float-delayed": {
          "0%, 100%": {
            transform: "translateY(10px) scale(0.9)",
          },
          "50%": {
            transform: "translateY(-10px) scale(1)",
          },
        },
        "pulse-slow": {
          "0%, 100%": {
            opacity: "0.3",
          },
          "50%": {
            opacity: "0.15",
          },
        },
      },
      colors: {
        primary: "oklch(0.55 0.22 263)",
        background: "#0f172a",
        foreground: "#e2e8f0",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        "btn-primary": "#69d0ff",
        "btn-secondary": "#b3e9ff",
        "btn-accent": "#8A6BFF",
        color: {
          Primary: "#9B51E0",
          Secondary: "#FFAA64",
        },
        stroke: {
          "1": "#1E1B24",
        },
        text: {
          primary: "#F8FAFC",
          secondary: "#B0BEC5",
          light: "#1F2937",
        },
        n: {
          "1": "#FFFFFF",
          "2": "#CAC6DD",
          "3": "#ADA8C3",
          "4": "#757185",
          "5": "#3F3A52",
          "6": "#252134",
          "7": "#15131D",
          "8": "#0E0C15",
          "9": "#474060",
          "10": "#43435C",
          "11": "#1B1B2E",
          "12": "#2E2A41",
          "13": "#6C7275",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        sans: ["var(--font-sora)", ...fontFamily.sans],
        code: "var(--font-code)",
        grotesk: "var(--font-grotesk)",
        fira: "var(--font-fira)",
        jetbrains: "var(--font-jetbrains)",

        atkinson: ["Atkinson Hyperlegible", ...fontFamily.sans],
        amiri: ["Amiri", "serif"],
        cairo: ["Cairo", ...fontFamily.sans],
        lemonada: ["Lemonada", ...fontFamily.sans],
        notoArabic: ["Noto Sans Arabic", ...fontFamily.sans],
        tajawal: ["Tajawal", ...fontFamily.sans],

        interLocal: ["Inter", ...fontFamily.sans],
        openSans: ["Open Sans", ...fontFamily.sans],
        robotoLocal: ["Roboto", ...fontFamily.sans],
        sourceSans3: ["Source Sans 3", ...fontFamily.sans],

        consolas: ["Consolas", ...fontFamily.mono],
        firaLocal: ["Fira Code", ...fontFamily.mono],
        ibmPlexMono: ["IBM Plex Mono", ...fontFamily.mono],
        jetbrainsLocal: ["JetBrains Mono", ...fontFamily.mono],

        sfArabic: ["SF Arabic", ...fontFamily.sans],
        sfArabicRounded: ["SF Arabic Rounded", ...fontFamily.sans],
        sfCompact: ["SF Compact", ...fontFamily.sans],
        sfCompactText: ["SF Compact Text", ...fontFamily.sans],
        sfMono: ["SF Mono", ...fontFamily.mono],
        newYorkLarge: ["New York Large", "serif"],

        sfProDisplay: ["SF Pro Display", ...fontFamily.sans],
        sfProText: ["SF Pro Text", ...fontFamily.sans],
        sfProRounded: ["SF Pro Rounded", ...fontFamily.sans],

        sfProDisplaySemibold: ["SF Pro Display Semibold", ...fontFamily.sans],
        sfProDisplayBold: ["SF Pro Display Bold", ...fontFamily.sans],
        sfProTextSemibold: ["SF Pro Text Semibold", ...fontFamily.sans],
        sfProTextBold: ["SF Pro Text Bold", ...fontFamily.sans],

        sfProRoundedUltralight: ["SF Pro Rounded Ultralight", ...fontFamily.sans],
        sfProRoundedRegular: ["SF Pro Rounded Regular", ...fontFamily.sans],
        sfProRoundedSemibold: ["SF Pro Rounded Semibold", ...fontFamily.sans],
        sfProRoundedBold: ["SF Pro Rounded Bold", ...fontFamily.sans],

        sfCompactRegular: ["SF Compact Regular", ...fontFamily.sans],
        sfCompactTextRegular: ["SF Compact Text Regular", ...fontFamily.sans],
        sfMonoRegular: ["SF Mono Regular", ...fontFamily.mono],
        sfArabicRegular: ["SF Arabic Regular", ...fontFamily.sans],
        sfArabicRoundedRegular: ["SF Arabic Rounded Regular", ...fontFamily.sans],
        newYorkLargeRegular: ["New York Large Regular", "serif"],
      },
      letterSpacing: {
        tagline: ".15em",
      },
      spacing: {
        "15": "3.75rem",
        "0.25": "0.0625rem",
        "7.5": "1.875rem",
      },
      opacity: {
        "15": ".15",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
      transitionTimingFunction: {
        DEFAULT: "linear",
      },
      zIndex: {
        "1": "1",
        "2": "2",
        "3": "3",
        "4": "4",
        "5": "5",
      },
      borderWidth: {
        DEFAULT: "0.0625rem",
      },
      willChange: {
        transform: "transform, opacity",
      },
      backdropBlur: {
        lg: "16px",
      },
      backgroundImage: ({ theme }) => ({
        "gradient-mystic-dusk": `linear-gradient(135deg, ${theme("colors.indigo.800")} 0%, ${theme("colors.blue.600")} 40%, ${theme("colors.gray.900")} 100%)`,
        "gradient-vivid-dream": `linear-gradient(120deg, ${theme("colors.purple.700")}, ${theme("colors.blue.500")}, ${theme("colors.cyan.400")})`,
        "gradient-ocean-wave": `linear-gradient(135deg, ${theme("colors.teal.700")} 0%, ${theme("colors.cyan.500")} 50%, ${theme("colors.blue.400")} 100%)`,
        "gradient-sunset-glow": `linear-gradient(135deg, ${theme("colors.orange.600")} 0%, ${theme("colors.pink.500")} 50%, ${theme("colors.red.400")} 100%)`,
        "gradient-starry-night": `linear-gradient(135deg, ${theme("colors.n.9")}, ${theme("colors.n.6")}, ${theme("colors.color.Primary")})`,
        "gradient-twilight": `linear-gradient(135deg, ${theme("colors.color.Primary")}, ${theme("colors.n.6")})`,
        "gradient-40":
          "linear-gradient(40deg, var(--gradient-start), var(--gradient-end))",
      }),
    },
  },
  plugins: [
    plugin(function ({ addBase, addComponents, addUtilities }) {
      addBase({});

      addComponents({
        ".container": {
          "@apply max-w-[77.5rem] mx-auto px-5 md:px-10 lg:px-15 xl:max-w-[87.5rem]":
            {},
        },
        ".h1": {
          "@apply font-semibold text-[2.5rem] leading-[3.25rem] md:text-[2.75rem] md:leading-[3.75rem] lg:text-[3.25rem] lg:leading-[4.0625rem] xl:text-[3.75rem] xl:leading-[4.5rem]":
            {},
        },
        ".h2": {
          "@apply text-[1.75rem] leading-[2.5rem] md:text-[2rem] md:leading-[2.5rem] lg:text-[2.5rem] lg:leading-[3.5rem] xl:text-[3rem] xl:leading-tight":
            {},
        },
        ".h3": {
          "@apply text-[2rem] leading-normal md:text-[2.5rem]": {},
        },
        ".h4": {
          "@apply text-[2rem] leading-normal": {},
        },
        ".h5": {
          "@apply text-2xl leading-normal": {},
        },
        ".h6": {
          "@apply font-semibold text-lg leading-8": {},
        },
        ".body-1": {
          "@apply text-[0.875rem] leading-[1.5rem] md:text-[1rem] md:leading-[1.75rem] lg:text-[1.25rem] lg:leading-8":
            {},
        },
        ".body-2": {
          "@apply font-light text-[0.875rem] leading-6 md:text-base": {},
        },
        ".caption": {
          "@apply text-sm": {},
        },
        ".tagline": {
          "@apply font-grotesk font-light text-xs tracking-tagline uppercase":
            {},
        },
        ".quote": {
          "@apply font-code text-lg leading-normal": {},
        },
        ".button": {
          "@apply font-code text-xs font-bold uppercase tracking-wider": {},
        },

        // --- الإضافات الجديدة هنا ---
        ".btn-main": {
          "@apply font-medium rounded-lg w-full border-2 border-[#69d0ff]/60 hover:border-[#69d0ff] bg-[#69d0ff]/10 hover:bg-[#69d0ff]/20 text-[#69d0ff] hover:text-[#b3e9ff] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#69d0ff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a1f]/50":
            {},
        },
        ".btn-purple": {
          "@apply font-medium rounded-lg w-full border border-[#8A6BFF] hover:bg-[#8A6BFF]/20 text-[#818cf8] hover:text-[#a5b4fc] transition-colors duration-300":
            {},
        },
        ".btn-sky": {
          "@apply font-medium rounded-lg py-5 w-full border-[#69d0ff] hover:bg-[#69d0ff]/20 text-[#60a5fa] hover:text-[#93c5fd] transition-colors duration-300":
            {},
        },
        ".btn-green": {
          "@apply font-medium rounded-lg w-full border-2 border-emerald-500/60 hover:border-emerald-500 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a1f]/50":
            {},
        },
        ".btn-danger": {
          "@apply font-medium rounded-lg w-full border-2 border-rose-500/60 hover:border-rose-500 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#0a0a1f]/50":
            {},
        },
      });

      addUtilities({
        ".tap-highlight-color": {
          "-webkit-tap-highlight-color": "rgba(0, 0, 0, 0)",
        },
      });
    }),
    addVariablesForColors,
  ],
} satisfies Config;

// Fixed function with corrected types
function addVariablesForColors({
  addBase,
  theme,
}: {
  addBase: (styles: Record<string, Record<string, string>>) => void;
  theme: (path: string) => Record<string, any>;
}) {
  // Explicitly type the result of flattenColorPalette as Record<string, string>
  const allColors: Record<string, string> = flattenColorPalette(
    theme("colors")
  );
  const newVars = Object.fromEntries(
    Object.entries(allColors).map(([key, val]) => [`--${key}`, String(val)])
  ) as Record<string, string>;

  addBase({
    ":root": newVars,
  });
}
