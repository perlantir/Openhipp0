// packages/mobile/src/screens/LlmConfigSection.tsx
// Settings-tab subsection for rotating the server's LLM provider/model/key.
// POSTs to /api/config/llm via the ApiClient; server hot-swaps the ladder.

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "../theme/useTheme.js";
import { useApiClient } from "../api/hooks.js";
import type {
  LlmProvider,
  UpdateLlmRequest,
  UpdateLlmResponse,
} from "../api/client.js";

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; hotSwapped: boolean; apiKeyUpdated: boolean }
  | { kind: "error"; message: string };

export interface LlmConfigSectionProps {
  /** Current server-reported values, used as form defaults. */
  initial?: { provider?: LlmProvider; model?: string };
  /** Override the mutation — tests pass a stub; production resolves ApiClient from the session. */
  save?: (req: UpdateLlmRequest) => Promise<UpdateLlmResponse>;
}

/**
 * Pure helper so the save/apply logic is testable without mounting React Native.
 * Returns the outbound request body; an empty `apiKey` is omitted rather than
 * sent as "" (the server would reject min(8)).
 */
export function buildUpdateLlmRequest(form: {
  provider: LlmProvider;
  apiKey: string;
  model: string;
}): UpdateLlmRequest {
  const req: UpdateLlmRequest = { provider: form.provider };
  const trimmedKey = form.apiKey.trim();
  if (trimmedKey.length > 0) req.apiKey = trimmedKey;
  const trimmedModel = form.model.trim();
  if (trimmedModel.length > 0) req.model = trimmedModel;
  return req;
}

const PROVIDERS: readonly LlmProvider[] = ["anthropic", "openai", "ollama"];

export function LlmConfigSection({ initial, save }: LlmConfigSectionProps) {
  const t = useTheme();
  const fallbackClient = useApiClient();
  const [provider, setProvider] = useState<LlmProvider>(initial?.provider ?? "anthropic");
  const [model, setModel] = useState<string>(initial?.model ?? "");
  const [apiKey, setApiKey] = useState<string>("");
  const [state, setState] = useState<SaveState>({ kind: "idle" });

  const needsKey = provider !== "ollama";

  const onSave = async (): Promise<void> => {
    setState({ kind: "saving" });
    const req = buildUpdateLlmRequest({ provider, apiKey, model });
    try {
      const mutate =
        save ??
        (async (r) => {
          if (!fallbackClient) throw new Error("No paired server. Complete pairing first.");
          return fallbackClient.updateLlmConfig(r);
        });
      const resp = await mutate(req);
      setState({
        kind: "saved",
        hotSwapped: resp.hotSwapped,
        apiKeyUpdated: resp.apiKeyUpdated,
      });
      setApiKey("");
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  };

  return (
    <View testID="llm-config-section">
      <Text
        style={[
          t.typography.label,
          {
            color: t.colors.text2,
            textTransform: "uppercase",
            paddingHorizontal: t.spacing.lg,
            paddingTop: t.spacing.lg,
            paddingBottom: t.spacing.sm,
          },
        ]}
      >
        LLM provider
      </Text>

      <View
        style={{
          flexDirection: "row",
          gap: t.spacing.sm,
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.sm,
        }}
      >
        {PROVIDERS.map((p) => (
          <Pressable
            key={p}
            testID={`llm-provider-${p}`}
            onPress={() => setProvider(p)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 40,
              paddingVertical: t.spacing.sm,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radii.control,
              backgroundColor:
                provider === p
                  ? t.colors.accent
                  : pressed
                    ? t.colors.surface2
                    : t.colors.surface1,
              borderWidth: 1,
              borderColor: provider === p ? t.colors.accent : t.colors.border,
            })}
          >
            <Text
              style={[
                t.typography.bodySm,
                { color: provider === p ? t.colors.accentOn : t.colors.text1 },
              ]}
            >
              {p}
            </Text>
          </Pressable>
        ))}
      </View>

      <View
        style={{
          paddingHorizontal: t.spacing.lg,
          paddingVertical: t.spacing.sm,
          gap: t.spacing.sm,
        }}
      >
        <Text style={[t.typography.bodySm, { color: t.colors.text2 }]}>Model</Text>
        <TextInput
          testID="llm-model"
          value={model}
          onChangeText={setModel}
          placeholder="(default for provider)"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            minHeight: 44,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radii.control,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: t.colors.surface1,
            color: t.colors.text1,
            fontFamily: t.typography.bodySm.fontFamily,
          }}
        />

        <Text style={[t.typography.bodySm, { color: t.colors.text2 }]}>API key</Text>
        <TextInput
          testID="llm-api-key"
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={needsKey ? "enter new key (leave blank to keep current)" : "n/a — local runtime"}
          editable={needsKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            minHeight: 44,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radii.control,
            borderWidth: 1,
            borderColor: t.colors.border,
            backgroundColor: needsKey ? t.colors.surface1 : t.colors.surface2,
            color: t.colors.text1,
            fontFamily: t.typography.bodySm.fontFamily,
          }}
        />

        <Pressable
          testID="llm-save"
          disabled={state.kind === "saving"}
          onPress={onSave}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingVertical: t.spacing.md,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radii.control,
            backgroundColor:
              state.kind === "saving"
                ? t.colors.text3
                : pressed
                  ? t.colors.accentPressed
                  : t.colors.accent,
          })}
        >
          <Text style={[t.typography.label, { color: t.colors.accentOn }]}>
            {state.kind === "saving" ? "Saving…" : "Save"}
          </Text>
        </Pressable>

        {state.kind === "saved" && (
          <Text testID="llm-saved" style={[t.typography.bodySm, { color: t.colors.success }]}>
            Saved
            {state.apiKeyUpdated ? " + key rotated" : ""}
            {state.hotSwapped ? " — hot-swapped live." : " — restart to apply."}
          </Text>
        )}
        {state.kind === "error" && (
          <Text testID="llm-error" style={[t.typography.bodySm, { color: t.colors.error }]}>
            {state.message}
          </Text>
        )}
      </View>
    </View>
  );
}
