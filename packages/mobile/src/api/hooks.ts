// packages/mobile/src/api/hooks.ts
// TanStack Query wrappers. Every hook resolves the ApiClient from the
// session store, so pairing state → URL + bearer → query works with zero
// boilerplate at call sites.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiClient } from "./client.js";
import { useSession } from "../store/session.js";

export function useApiClient(): ApiClient | null {
  const session = useSession();
  if (!session.serverUrl || !session.apiBearer) return null;
  return new ApiClient({ baseUrl: session.serverUrl, bearer: session.apiBearer });
}

function requireClient(client: ApiClient | null): ApiClient {
  if (!client) throw new Error("No paired server. Complete pairing first.");
  return client;
}

export function useHealth(): UseQueryResult<{ status: string }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ["health"],
    queryFn: () => requireClient(client).getHealth(),
    enabled: client !== null,
    refetchInterval: 5000,
  });
}

export function useAgents() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => requireClient(client).getAgents(),
    enabled: client !== null,
  });
}

export function useCronTasks() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["cron"],
    queryFn: () => requireClient(client).getCron(),
    enabled: client !== null,
  });
}

export function useSkills() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => requireClient(client).getSkills(),
    enabled: client !== null,
  });
}

export function useDecisions(limit = 50) {
  const client = useApiClient();
  return useQuery({
    queryKey: ["decisions", limit],
    queryFn: () => requireClient(client).listDecisions({ limit }),
    enabled: client !== null,
  });
}

export function useMemoryStats() {
  const client = useApiClient();
  return useQuery({
    queryKey: ["memory-stats"],
    queryFn: () => requireClient(client).getMemoryStats(),
    enabled: client !== null,
  });
}
