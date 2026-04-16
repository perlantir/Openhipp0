// packages/mobile/src/chat/MessageBubble.tsx
// Chat bubble renderer. User = contained bubble on surface-2. Assistant =
// flat text, no bubble (observed claude.ai pattern documented in the
// claude-ai-mobile design skill).

import { Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import type { ChatMessage } from "./useChatStream.js";

export interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const t = useTheme();
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <View
        style={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          marginVertical: 4,
          paddingHorizontal: t.spacing.lg,
        }}
      >
        <View
          style={{
            backgroundColor: t.colors.surface2,
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.md,
            borderRadius: t.radii.component,
          }}
        >
          <Text style={[t.typography.body, { color: t.colors.text1 }]}>{message.text}</Text>
        </View>
      </View>
    );
  }

  // Assistant — flat, full-width
  return (
    <View
      style={{
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.sm,
      }}
    >
      <Text style={[t.typography.body, { color: t.colors.text1 }]}>
        {message.text}
        {message.streaming ? (
          <Text style={{ color: t.colors.text3 }}>…</Text>
        ) : null}
      </Text>
    </View>
  );
}
