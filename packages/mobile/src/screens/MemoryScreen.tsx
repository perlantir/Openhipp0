// packages/mobile/src/screens/MemoryScreen.tsx
// Memory overview: stats cards + recent decisions list.

import { ActivityIndicator, Text, View } from "react-native";
import { TypedFlatList } from "../components/TypedFlatList.js";
import { useTheme } from "../theme/useTheme.js";
import { useDecisions, useMemoryStats } from "../api/hooks.js";
import type { DecisionSummary, MemoryStats } from "../api/client.js";
import { ScreenHeader } from "./ScreenHeader.js";
import { EmptyState } from "./EmptyState.js";

function StatCard({ label, value }: { label: string; value: string | number }) {
  const t = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.surface1,
        borderColor: t.colors.border,
        borderWidth: 1,
        borderRadius: t.radii.component,
        padding: t.spacing.lg,
      }}
    >
      <Text style={[t.typography.caption, { color: t.colors.text3, marginBottom: t.spacing.xs }]}>{label}</Text>
      <Text style={[t.typography.h2, { color: t.colors.text1 }]}>{value}</Text>
    </View>
  );
}

export function MemoryScreen() {
  const t = useTheme();
  const statsQuery = useMemoryStats();
  const decisionsQuery = useDecisions(20);

  if (statsQuery.isLoading || decisionsQuery.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={t.colors.text3} />
      </View>
    );
  }

  if (statsQuery.error || !statsQuery.data) {
    return (
      <EmptyState
        iconText="!"
        title="Couldn't load memory"
        description={
          statsQuery.error instanceof Error ? statsQuery.error.message : "Check your connection."
        }
      />
    );
  }

  const stats: MemoryStats = statsQuery.data;
  const decisions: readonly DecisionSummary[] = decisionsQuery.data?.decisions ?? [];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Memory" />
      <View style={{ padding: t.spacing.lg }}>
        <View style={{ flexDirection: "row", gap: t.spacing.md, marginBottom: t.spacing.lg }}>
          <StatCard label="Decisions" value={stats.decisions} />
          <StatCard label="Skills" value={stats.skills} />
        </View>
        <View style={{ flexDirection: "row", gap: t.spacing.md }}>
          <StatCard label="Sessions" value={stats.sessions} />
          <StatCard label="User facts" value={stats.userFacts} />
        </View>
      </View>

      <Text
        style={[
          t.typography.label,
          {
            color: t.colors.text2,
            textTransform: "uppercase",
            paddingHorizontal: t.spacing.lg,
            paddingTop: t.spacing.md,
            paddingBottom: t.spacing.sm,
          },
        ]}
      >
        Recent decisions
      </Text>
      <TypedFlatList<DecisionSummary>
        data={decisions as DecisionSummary[]}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => (
          <View
            style={{
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.md,
              borderBottomColor: t.colors.border,
              borderBottomWidth: 1,
              gap: 4,
            }}
          >
            <Text style={[t.typography.body, { color: t.colors.text1 }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.text3 }]}>
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            iconText="·"
            title="No decisions yet"
            description="Decisions made by your agents will appear here as they work."
          />
        }
      />
    </View>
  );
}
