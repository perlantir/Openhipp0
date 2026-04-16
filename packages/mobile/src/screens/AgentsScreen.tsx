// packages/mobile/src/screens/AgentsScreen.tsx
// Lists agents from GET /api/config/agents. List-row pattern from the
// design skill: 52dp min-height, border-bottom between rows.

import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import { useAgents } from "../api/hooks.js";
import type { AgentSummary } from "../api/client.js";
import { ScreenHeader } from "./ScreenHeader.js";
import { EmptyState } from "./EmptyState.js";

export function AgentsScreen() {
  const t = useTheme();
  const { data, isLoading, error } = useAgents();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.colors.text3} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        iconText="!"
        title="Couldn't load agents"
        description={error instanceof Error ? error.message : "Check your connection."}
      />
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        iconText="+"
        title="No agents yet"
        description="Add your first agent from the dashboard, or tap below to use a template."
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Agents" subtitle={`${data.length} configured`} />
      <FlatList<AgentSummary>
        data={data as AgentSummary[]}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => ({
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.md,
              minHeight: 52,
              backgroundColor: pressed ? t.colors.surface1 : "transparent",
              borderBottomColor: t.colors.border,
              borderBottomWidth: 1,
              gap: 4,
            })}
          >
            <Text style={[t.typography.body, { color: t.colors.text1 }]}>{item.name}</Text>
            {item.description ? (
              <Text style={[t.typography.caption, { color: t.colors.text3 }]} numberOfLines={1}>
                {item.description}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}
