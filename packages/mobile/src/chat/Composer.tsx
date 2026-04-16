// packages/mobile/src/chat/Composer.tsx
// Chat composer — multi-line input + send button + mic (voice input is
// wired via expo-av in the full runtime; here we expose an onVoicePressed
// hook that the host screen can bind).

import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Send, Mic, Plus } from "lucide-react-native";
import { useTheme } from "../theme/useTheme.js";

export interface ComposerProps {
  onSend: (text: string) => boolean;
  onVoicePressed?: () => void;
  onAttachPressed?: () => void;
  disabled?: boolean;
  /** When provided, replaces the current draft (e.g., Whisper transcript). */
  initialValue?: string;
}

export function Composer({ onSend, onVoicePressed, onAttachPressed, disabled, initialValue }: ComposerProps) {
  const t = useTheme();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (initialValue !== undefined) setValue(initialValue);
  }, [initialValue]);
  const canSend = value.trim().length > 0 && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    const ok = onSend(value);
    if (ok) setValue("");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{
        borderTopColor: t.colors.border,
        borderTopWidth: 1,
        backgroundColor: t.colors.background,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: t.spacing.sm,
          paddingHorizontal: t.spacing.md,
          paddingVertical: t.spacing.md,
        }}
      >
        {onAttachPressed ? (
          <Pressable
            onPress={onAttachPressed}
            accessibilityRole="button"
            accessibilityLabel="Attach"
            hitSlop={8}
            style={[styles.iconBtn, { backgroundColor: "transparent" }]}
          >
            <Plus color={t.colors.text2} size={20} strokeWidth={2} />
          </Pressable>
        ) : null}

        <View
          style={{
            flex: 1,
            backgroundColor: t.colors.surface1,
            borderColor: t.colors.borderVisible,
            borderWidth: 1,
            borderRadius: t.radii.component,
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.sm,
            minHeight: 48,
            maxHeight: 160,
            justifyContent: "center",
          }}
        >
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Message Claude"
            placeholderTextColor={t.colors.text3}
            multiline
            style={[t.typography.body, { color: t.colors.text1, maxHeight: 140 }]}
            editable={!disabled}
          />
        </View>

        {value.trim().length === 0 && onVoicePressed ? (
          <Pressable
            onPress={onVoicePressed}
            accessibilityRole="button"
            accessibilityLabel="Voice input"
            hitSlop={8}
            style={[styles.iconBtn, { backgroundColor: "transparent" }]}
          >
            <Mic color={t.colors.text2} size={20} strokeWidth={2} />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            hitSlop={8}
            style={({ pressed }) => [
              styles.iconBtn,
              {
                backgroundColor: !canSend
                  ? t.colors.surface3
                  : pressed
                    ? t.colors.accentPressed
                    : t.colors.accent,
              },
            ]}
          >
            <Send color={!canSend ? t.colors.text4 : t.colors.accentOn} size={18} strokeWidth={2.25} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
