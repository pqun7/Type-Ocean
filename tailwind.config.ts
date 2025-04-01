import { heroui } from '@heroui/theme';
import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";
import plugin from "tailwindcss/plugin";
const colors = require("tailwindcss/colors");
const { default: flattenColorPalette } = require("tailwindcss/lib/util/flattenColorPalette");

export default {
  darkMode: ["class", "class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/components/progress.js"
  ],
  theme: {
    extend: {
      animation: {
        first: 'moveVertical 30s ease infinite',
        second: 'moveInCircle 20s reverse infinite',
        third: 'moveInCircle 40s linear infinite',
        fourth: 'moveHorizontal 40s ease infinite',
        fifth: 'moveInCircle 20s ease infinite',
        shimmer: 'shimmer 2s linear infinite',
        softPulse: 'softPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        float: 'float 8s ease-in-out infinite',
        'float-delayed': 'float-delayed 10s ease-in-out infinite',
        'pulse-slow': 'pulse-slow 6s ease-in-out infinite',
        bubble: 'bubble 15s infinite ease-in-out',
        wave: 'wave 20s linear infinite',
        'wave-opacity': 'wave-opacity 12s ease-in-out infinite'
      },
      dropShadow: {
        glow: [
          '0 0px 20px rgba(255,255, 255, 0.35)',
          '0 0px 65px rgba(255, 255,255, 0.2)'
        ]
      },
      keyframes: {
        'wave-opacity': {
          '0%, 100%': {
            transform: 'translateX(0) scaleY(1)',
            opacity: '0.4'
          },
          '50%': {
            transform: 'translateX(-25%) scaleY(0.9)',
            opacity: '0.6'
          }
        },
        moveHorizontal: {
          '0%': {
            transform: 'translateX(-50%) translateY(-10%)'
          },
          '50%': {
            transform: 'translateX(50%) translateY(10%)'
          },
          '100%': {
            transform: 'translateX(-50%) translateY(-10%)'
          }
        },
        bubble: {
          '0%, 100%': {
            transform: 'translateY(0) scale(1)'
          },
          '50%': {
            transform: 'translateY(-100px) scale(1.2)'
          }
        },
        wave: {
          '0%': {
            transform: 'translateX(0)'
          },
          '100%': {
            transform: 'translateX(-50%)'
          }
        },
        moveInCircle: {
          '0%': {
            transform: 'rotate(0deg)'
          },
          '50%': {
            transform: 'rotate(180deg)'
          },
          '100%': {
            transform: 'rotate(360deg)'
          }
        },
        moveVertical: {
          '0%': {
            transform: 'translateY(-50%)'
          },
          '50%': {
            transform: 'translateY(50%)'
          },
          '100%': {
            transform: 'translateY(-50%)'
          }
        },
        shimmer: {
          from: {
            backgroundPosition: '0 0'
          },
          to: {
            backgroundPosition: '-200% 0'
          }
        },
        softPulse: {
          '0%, 100%': {
            opacity: '0.9',
            filter: 'drop-shadow(0 0 2px rgba(0, 0, 0, 0.1))'
          },
          '50%': {
            opacity: '1',
            filter: 'drop-shadow(0 0 6px rgba(0, 0, 0, 0.15))'
          }
        },
        float: {
          '0%, 100%': {
            transform: 'translateY(0) scale(1)'
          },
          '50%': {
            transform: 'translateY(-20px) scale(1.05)'
          }
        },
        'float-delayed': {
          '0%, 100%': {
            transform: 'translateY(10px) scale(0.9)'
          },
          '50%': {
            transform: 'translateY(-10px) scale(1)'
          }
        },
        'pulse-slow': {
          '0%, 100%': {
            opacity: '0.3'
          },
          '50%': {
            opacity: '0.15'
          }
        }
      },
      colors: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        color: {
          Primary: '#9B51E0',
          Secondary: '#FFAA64'
        },
        stroke: {
          '1': '#1E1B24'
        },
        text: {
          primary: '#F8FAFC',
          secondary: '#B0BEC5',
          light: '#1F2937'
        },
        n: {
          '1': '#FFFFFF',
          '2': '#CAC6DD',
          '3': '#ADA8C3',
          '4': '#757185',
          '5': '#3F3A52',
          '6': '#252134',
          '7': '#15131D',
          '8': '#0E0C15',
          '9': '#474060',
          '10': '#43435C',
          '11': '#1B1B2E',
          '12': '#2E2A41',
          '13': '#6C7275'
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))'
        }
      },
      fontFamily: {
        sans: [
          'var(--font-sora)',
          ...fontFamily.sans
        ],
        code: 'var(--font-code)',
        grotesk: 'var(--font-grotesk)',
        fira: 'var(--font-fira)',
        jetbrains: 'var(--font-jetbrains)'
      },
      letterSpacing: {
        tagline: '.15em'
      },
      spacing: {
        '15': '3.75rem',
        '0.25': '0.0625rem',
        '7.5': '1.875rem'
      },
      opacity: {
        '15': '.15'
      },
      transitionDuration: {
        DEFAULT: '200ms'
      },
      transitionTimingFunction: {
        DEFAULT: 'linear'
      },
      zIndex: {
        '1': '1',
        '2': '2',
        '3': '3',
        '4': '4',
        '5': '5'
      },
      borderWidth: {
        DEFAULT: '0.0625rem'
      },
      willChange: {
        transform: 'transform, opacity'
      },
      backdropBlur: {
        lg: '16px'
      },
      backgroundImage: ({ theme }) => ({
        "gradient-mystic-dusk": `linear-gradient(135deg, ${theme("colors.indigo.800")} 0%, ${theme("colors.blue.600")} 40%, ${theme("colors.gray.900")} 100%)`,
        "gradient-vivid-dream": `linear-gradient(120deg, ${theme("colors.purple.700")}, ${theme("colors.blue.500")}, ${theme("colors.cyan.400")})`,
        "gradient-ocean-wave": `linear-gradient(135deg, ${theme("colors.teal.700")} 0%, ${theme("colors.cyan.500")} 50%, ${theme("colors.blue.400")} 100%)`,
        "gradient-sunset-glow": `linear-gradient(135deg, ${theme("colors.orange.600")} 0%, ${theme("colors.pink.500")} 50%, ${theme("colors.red.400")} 100%)`,
        "gradient-starry-night": `linear-gradient(135deg, ${theme("colors.n.9")}, ${theme("colors.n.6")}, ${theme("colors.color.Primary")})`,
        "gradient-twilight": `linear-gradient(135deg, ${theme("colors.color.Primary")}, ${theme("colors.n.6")})`,
        "gradient-40": "linear-gradient(40deg, var(--gradient-start), var(--gradient-end))",
      })
    }
  },
  plugins: [
    plugin(function ({ addBase, addComponents, addUtilities }) {
      addBase({});
      addComponents({
        ".container": {
          "@apply max-w-[77.5rem] mx-auto px-5 md:px-10 lg:px-15 xl:max-w-[87.5rem]": {},
        },
        ".h1": {
          "@apply font-semibold text-[2.5rem] leading-[3.25rem] md:text-[2.75rem] md:leading-[3.75rem] lg:text-[3.25rem] lg:leading-[4.0625rem] xl:text-[3.75rem] xl:leading-[4.5rem]": {},
        },
        ".h2": {
          "@apply text-[1.75rem] leading-[2.5rem] md:text-[2rem] md:leading-[2.5rem] lg:text-[2.5rem] lg:leading-[3.5rem] xl:text-[3rem] xl:leading-tight": {},
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
          "@apply text-[0.875rem] leading-[1.5rem] md:text-[1rem] md:leading-[1.75rem] lg:text-[1.25rem] lg:leading-8": {},
        },
        ".body-2": {
          "@apply font-light text-[0.875rem] leading-6 md:text-base": {},
        },
        ".caption": {
          "@apply text-sm": {},
        },
        ".tagline": {
          "@apply font-grotesk font-light text-xs tracking-tagline uppercase": {},
        },
        ".quote": {
          "@apply font-code text-lg leading-normal": {},
        },
        ".button": {
          "@apply font-code text-xs font-bold uppercase tracking-wider": {},
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
function addVariablesForColors({ addBase, theme }: { 
  addBase: (styles: Record<string, Record<string, string>>) => void; 
  theme: (path: string) => Record<string, any>; 
}) {
  // Explicitly type the result of flattenColorPalette as Record<string, string>
  const allColors: Record<string, string> = flattenColorPalette(theme("colors"));
  const newVars = Object.fromEntries(
    Object.entries(allColors).map(([key, val]) => [`--${key}`, String(val)])
  ) as Record<string, string>;

  addBase({
    ":root": newVars,
  });
}