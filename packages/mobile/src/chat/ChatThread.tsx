// packages/mobile/src/chat/ChatThread.tsx
// Full chat screen: scroll of messages + composer anchored to keyboard.
// Streaming is handled by useChatStream; approval cards inline with
// assistant messages whenever the stream emits an approval-request.

import { useRef, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import { useChatStream, type ChatMessage } from "./useChatStream.js";
import { MessageBubble } from "./MessageBubble.js";
import { Composer } from "./Composer.js";
import { useSession } from "../store/session.js";
import { useApiClient } from "../api/hooks.js";
import { useVoiceInput } from "../voice/useVoiceInput.js";

export function ChatThread() {
  const t = useTheme();
  const session = useSession();
  const { messages, status, send } = useChatStream();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const api = useApiClient();
  const voice = useVoiceInput(api!);
  const [voiceDraft, setVoiceDraft] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  if (!session.serverUrl) {
    return (
      <View style={styles.centered}>
        <Text style={[t.typography.h3, { color: t.colors.text1, marginBottom: t.spacing.sm }]}>
          Not paired
        </Text>
        <Text style={[t.typography.bodySm, { color: t.colors.text3, textAlign: "center", maxWidth: 280 }]}>
          Open Settings on your dashboard, tap "Pair Mobile Device", and scan the QR from this app.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      {status !== "open" ? (
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.xs,
            backgroundColor: t.colors.surface1,
            borderBottomColor: t.colors.border,
            borderBottomWidth: 1,
          }}
        >
          <Text style={[t.typography.caption, { color: t.colors.text3 }]}>
            Status: {status}
          </Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={{
          paddingVertical: t.spacing.md,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          <View style={styles.centered}>
            <Text style={[t.typography.display, { color: t.colors.text2, marginBottom: t.spacing.sm }]}>
              Claude
            </Text>
            <Text
              style={[
                t.typography.body,
                { color: t.colors.text3, textAlign: "center", maxWidth: 280 },
              ]}
            >
              Ask me anything. Your messages are end-to-end encrypted to your paired server.
            </Text>
          </View>
        }
      />

      {voice.isRecording || voice.isTranscribing ? (
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.xs,
            backgroundColor: t.colors.surface1,
            borderTopColor: t.colors.border,
            borderTopWidth: 1,
            alignItems: "center",
          }}
        >
          <Text style={[t.typography.caption, { color: t.colors.text3 }]}>
            {voice.isRecording ? "🎙 Listening — tap mic again to stop" : "Transcribing…"}
          </Text>
        </View>
      ) : null}
      {voice.lastError ? (
        <View
          style={{
            paddingHorizontal: t.spacing.lg,
            paddingVertical: t.spacing.xs,
            backgroundColor: t.colors.surface1,
            borderTopColor: t.colors.border,
            borderTopWidth: 1,
          }}
        >
          <Text style={[t.typography.caption, { color: t.colors.error }]}>{voice.lastError}</Text>
        </View>
      ) : null}

      <Composer
        onSend={send}
        initialValue={voiceDraft}
        onVoicePressed={
          api
            ? async () => {
                if (voice.isRecording) {
                  const text = await voice.stop();
                  if (text) setVoiceDraft(text);
                } else {
                  setVoiceDraft(undefined);
                  await voice.start();
                }
              }
            : undefined
        }
        disabled={status !== "open"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 48,
    paddingVertical: 48,
  },
});
