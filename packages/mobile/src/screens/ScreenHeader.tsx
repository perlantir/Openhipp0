// packages/mobile/src/screens/ScreenHeader.tsx
// Consistent screen title treatment. Used by every tab screen.

import { Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
}

export function ScreenHeader({ title, subtitle }: ScreenHeaderProps) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.border,
        backgroundColor: t.colors.background,
      }}
    >
      <Text style={[t.typography.h2, { color: t.colors.text1 }]}>{title}</Text>
      {subtitle ? (
        <Text style={[t.typography.caption, { color: t.colors.text3, marginTop: 2 }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}
