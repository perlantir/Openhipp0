// packages/mobile/app/(tabs)/_layout.tsx
// Bottom tab bar — 5 tabs per Phase 19 spec. Tab-bar visuals follow the
// claude-ai-mobile design skill (no shadows, accent on active, caption
// label 12dp weight 500).

import { Tabs } from "expo-router";
import { Text } from "react-native";
import {
  MessageSquare,
  Users,
  Brain,
  Zap,
  Settings,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "../../src/theme/useTheme.js";

type TabConfig = {
  name: string;
  title: string;
  Icon: LucideIcon;
};

const TABS: readonly TabConfig[] = [
  { name: "index", title: "Chat", Icon: MessageSquare },
  { name: "agents", title: "Agents", Icon: Users },
  { name: "memory", title: "Memory", Icon: Brain },
  { name: "automations", title: "Tasks", Icon: Zap },
  { name: "settings", title: "Settings", Icon: Settings },
] as const;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.colors.surface1,
          borderTopColor: t.colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: t.colors.accent,
        tabBarInactiveTintColor: t.colors.text3,
        tabBarLabel: ({ focused, color, children }) => (
          <Text
            style={{
              ...t.typography.caption,
              color,
              fontWeight: focused ? "600" : "500",
              marginTop: 2,
            }}
          >
            {children}
          </Text>
        ),
      }}
    >
      {TABS.map(({ name, title, Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <Icon color={color} size={24} strokeWidth={focused ? 2.25 : 2} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
