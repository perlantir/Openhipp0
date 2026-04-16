// packages/mobile/app/(tabs)/memory.tsx
// Memory tab — decisions list, skills, user model. Data comes from
// GET /api/memory/stats + GET /api/decisions (wired in 19.F).

import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme/useTheme.js";
import { MemoryScreen } from "../../src/screens/MemoryScreen.js";

export default function MemoryTab() {
  const t = useTheme();
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: t.colors.background }}>
      <MemoryScreen />
    </SafeAreaView>
  );
}
