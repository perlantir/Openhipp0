// packages/mobile/src/screens/EmptyState.tsx
// Empty-state pattern from design skill: centered, 48dp glyph-equivalent,
// h3 title + bodySm description in text3.

import { Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";

export interface EmptyStateProps {
  iconText: string;
  title: string;
  description?: string;
}

export function EmptyState({ iconText, title, description }: EmptyStateProps) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: t.spacing.xxxl,
        gap: t.spacing.md,
      }}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: t.colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={[t.typography.h2, { color: t.colors.text4 }]}>{iconText}</Text>
      </View>
      <Text style={[t.typography.h3, { color: t.colors.text1, textAlign: "center" }]}>{title}</Text>
      {description ? (
        <Text
          style={[
            t.typography.bodySm,
            { color: t.colors.text3, textAlign: "center", maxWidth: 280 },
          ]}
        >
          {description}
        </Text>
      ) : null}
    </View>
  );
}
