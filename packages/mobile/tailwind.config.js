// packages/mobile/tailwind.config.js
// NativeWind (Tailwind-for-RN) — token names match src/theme/index.ts.
// Dark mode is keyed off the `.dark` class applied to the root View by
// app/_layout.tsx based on useColorScheme().
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#FAF9F5",
        "surface-1": "#F5F4EE",
        "surface-2": "#E8E6DC",
        "surface-3": "#D6D3C4",
        border: "#E8E6DC",
        "border-vis": "#D6D3C4",
        "text-1": "#131314",
        "text-2": "#55524A",
        "text-3": "#756F63",
        "text-4": "#A8A49A",
        accent: "#D97757",
        "accent-pr": "#CC785C",
        "accent-sub": "#FDF3EE",
        "accent-on": "#FFFFFF",
        success: "#5C8A6F",
        warning: "#C78A3A",
        error: "#B8453C",
      },
      spacing: {
        "2xs": "2px",
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
        "3xl": "48px",
        "4xl": "64px",
      },
      borderRadius: {
        element: "6px",
        control: "10px",
        component: "16px",
        container: "20px",
        pill: "999px",
      },
      fontSize: {
        display: ["32px", { lineHeight: "37px", letterSpacing: "-0.01em" }],
        h1: ["28px", { lineHeight: "34px", letterSpacing: "-0.01em" }],
        h2: ["22px", { lineHeight: "28px", letterSpacing: "-0.005em" }],
        h3: ["17px", { lineHeight: "22px" }],
        body: ["16px", { lineHeight: "24px" }],
        "body-sm": ["14px", { lineHeight: "20px" }],
        caption: ["12px", { lineHeight: "16px" }],
        label: ["13px", { lineHeight: "17px", letterSpacing: "0.04em" }],
        mono: ["14px", { lineHeight: "21px" }],
      },
    },
    fontFamily: {
      sans: ["System"],
      mono: ["Menlo"],
    },
  },
  darkMode: "class",
  plugins: [],
};
