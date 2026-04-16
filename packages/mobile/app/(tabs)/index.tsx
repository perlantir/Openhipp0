// packages/mobile/app/(tabs)/index.tsx
// Chat tab entry point. The interactive chat components live in
// src/chat/ — this file just mounts the thread. Interactivity is
// wired up in 19.G.

import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/useTheme.js";
import { ChatThread } from "../../src/chat/ChatThread.js";

export default function ChatTab() {
  const t = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View
        style={{
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
          backgroundColor: t.colors.background,
        }}
      >
        <Text style={[t.typography.h2, { color: t.colors.text1 }]}>Claude</Text>
      </View>
      <ChatThread />
    </SafeAreaView>
  );
}
