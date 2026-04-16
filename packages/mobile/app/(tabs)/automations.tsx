// packages/mobile/app/(tabs)/automations.tsx
// Automations tab — lists scheduled cron tasks from GET /api/config/cron.

import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/useTheme.js";
import { useCronTasks } from "../../src/api/hooks.js";
import type { CronTaskSummary } from "../../src/api/client.js";
import { ScreenHeader } from "../../src/screens/ScreenHeader.js";
import { EmptyState } from "../../src/screens/EmptyState.js";

export default function AutomationsTab() {
  const t = useTheme();
  const { data, isLoading, error } = useCronTasks();
  const tasks = (data ?? []) as readonly CronTaskSummary[];

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <ScreenHeader title="Automations" subtitle={`${tasks.length} scheduled`} />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={t.colors.text3} />
        </View>
      ) : error ? (
        <EmptyState
          iconText="!"
          title="Couldn't load automations"
          description={error instanceof Error ? error.message : "Check your connection."}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          iconText="·"
          title="No automations yet"
          description="Schedule tasks from the dashboard or CLI. They'll appear here."
        />
      ) : (
        <FlatList<CronTaskSummary>
          data={tasks as CronTaskSummary[]}
          keyExtractor={(k) => k.id}
          renderItem={({ item }) => (
            <View
              style={{
                paddingHorizontal: t.spacing.lg,
                paddingVertical: t.spacing.md,
                borderBottomColor: t.colors.border,
                borderBottomWidth: 1,
              }}
            >
              <Text style={[t.typography.body, { color: t.colors.text1 }]}>{item.name}</Text>
              <Text style={[t.typography.caption, { color: t.colors.text3, marginTop: 2 }]}>
                {item.schedule}
                {item.nextFireAt ? ` · next ${new Date(item.nextFireAt).toLocaleString()}` : ""}
                {item.enabled ? "" : " · disabled"}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
