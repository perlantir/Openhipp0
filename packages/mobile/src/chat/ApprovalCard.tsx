// packages/mobile/src/chat/ApprovalCard.tsx
// Inline approval card. Mobile-specific component (derived in skill) —
// agent pauses, asks user to approve/reject a high-risk action.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";

export interface ApprovalCardProps {
  title: string;
  description: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalCard({
  title,
  description,
  primaryLabel = "Approve",
  secondaryLabel = "Reject",
  onApprove,
  onReject,
}: ApprovalCardProps) {
  const t = useTheme();
  return (
    <View
      style={{
        marginHorizontal: t.spacing.lg,
        marginVertical: t.spacing.sm,
        backgroundColor: t.colors.surface1,
        borderColor: t.colors.borderVisible,
        borderWidth: 1,
        borderRadius: t.radii.container,
        padding: t.spacing.lg,
        ...t.elevation.shadow1,
      }}
    >
      <Text style={[t.typography.h3, { color: t.colors.text1, marginBottom: t.spacing.xs }]}>
        {title}
      </Text>
      <Text
        style={[
          t.typography.bodySm,
          { color: t.colors.text2, marginBottom: t.spacing.lg },
        ]}
      >
        {description}
      </Text>
      <View style={{ flexDirection: "row", gap: t.spacing.md }}>
        <Pressable
          onPress={onReject}
          style={({ pressed }) => [
            styles.btn,
            {
              flex: 1,
              backgroundColor: pressed ? t.colors.surface2 : "transparent",
              borderColor: t.colors.borderVisible,
              borderWidth: 1,
              borderRadius: t.radii.control,
            },
          ]}
        >
          <Text style={[t.typography.label, { color: t.colors.text1 }]}>{secondaryLabel}</Text>
        </Pressable>
        <Pressable
          onPress={onApprove}
          style={({ pressed }) => [
            styles.btn,
            {
              flex: 1,
              backgroundColor: pressed ? t.colors.accentPressed : t.colors.accent,
              borderRadius: t.radii.control,
            },
          ]}
        >
          <Text style={[t.typography.label, { color: t.colors.accentOn }]}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
