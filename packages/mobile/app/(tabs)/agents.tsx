// packages/mobile/app/(tabs)/agents.tsx
// Agents tab — lists configured agents from GET /api/config/agents.
// Interactive wiring is handled by shared src/screens/AgentsScreen.tsx.

import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/useTheme.js";
import { AgentsScreen } from "../../src/screens/AgentsScreen.js";

export default function AgentsTab() {
  const t = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <AgentsScreen />
    </SafeAreaView>
  );
}
