// packages/mobile/src/theme/colors.ts
// Semantic color tokens sourced from claude-ai-mobile-design/design-model.yaml.
// Light mode is the brand cream; dark mode uses the observed #131314 canvas.
// Do not import primitive hex values — always use semantic tokens.

export const colorsLight = {
  background: "#FAF9F5",
  surface1: "#F5F4EE",
  surface2: "#E8E6DC",
  surface3: "#D6D3C4",
  border: "#E8E6DC",
  borderVisible: "#D6D3C4",
  text1: "#131314",
  text2: "#55524A",
  text3: "#756F63",
  text4: "#A8A49A",
  accent: "#D97757",
  accentPressed: "#CC785C",
  accentSubtle: "#FDF3EE",
  accentOn: "#FFFFFF",
  selection: "rgba(204, 120, 92, 0.5)",
  success: "#5C8A6F",
  warning: "#C78A3A",
  error: "#B8453C",
} as const;

export const colorsDark = {
  background: "#131314",
  surface1: "#1F1E1D",
  surface2: "#2A2826",
  surface3: "#363330",
  border: "#2A2826",
  borderVisible: "#363330",
  text1: "#F5F4EE",
  text2: "#A8A49A",
  text3: "#756F63",
  text4: "#55524A",
  accent: "#E28561",
  accentPressed: "#D97757",
  accentSubtle: "#451E10",
  accentOn: "#131314",
  selection: "rgba(226, 133, 97, 0.4)",
  success: "#5C8A6F",
  warning: "#C78A3A",
  error: "#B8453C",
} as const;

export type ColorTokens = typeof colorsLight;
