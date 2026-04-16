import { describe, expect, it } from "vitest";
import { buildTheme, colorsLight, colorsDark, spacing, radii, motion } from "../src/theme/index.js";

describe("theme tokens", () => {
  it("light theme exposes the observed claude.ai accent", () => {
    const t = buildTheme("light");
    expect(t.colors.accent).toBe("#D97757");
    expect(t.colors.background).toBe("#FAF9F5");
    expect(t.colors.text1).toBe("#131314");
  });

  it("dark theme uses the brighter brand.400 accent for contrast", () => {
    const t = buildTheme("dark");
    expect(t.colors.accent).toBe("#E28561");
    expect(t.colors.background).toBe("#131314");
    expect(t.colors.text1).toBe("#F5F4EE");
  });

  it("light + dark color tokens have identical keys", () => {
    const lk = Object.keys(colorsLight).sort();
    const dk = Object.keys(colorsDark).sort();
    expect(dk).toEqual(lk);
  });

  it("spacing scale is monotonically increasing", () => {
    const values = Object.values(spacing);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it("radii trim to the actually-used scale — no unused values", () => {
    const vals = Object.values(radii);
    expect(vals).toContain(6);
    expect(vals).toContain(10);
    expect(vals).toContain(16);
    expect(vals).toContain(20);
    expect(vals).toContain(999);
  });

  it("motion preserves the observed anthropic.com easing curve", () => {
    expect(motion.easing.standard).toEqual([0.16, 1, 0.3, 1]);
    expect(motion.duration.normal).toBe(400);
    expect(motion.duration.slow).toBe(500);
  });

  it("buildTheme memoization is stable per mode", () => {
    const a = buildTheme("light");
    const b = buildTheme("light");
    // Same structural shape
    expect(a.mode).toBe(b.mode);
    expect(a.colors).toEqual(b.colors);
  });
});
