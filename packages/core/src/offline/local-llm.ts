/**
 * Local LLM fallback — summarize + classify only.
 *
 * Per scope: Ollama's tool-call support on small models is unreliable,
 * so tool use stays cloud-only in v1. Local is limited to two
 * operations where a medium-quality answer is strictly better than no
 * answer (summarization of session history, classification of
 * intent / sentiment / category).
 *
 * `LocalLLMFallback` is a thin interface; operators plug their own
 * Ollama / llama.cpp / vllm client behind it. Tests pass a deterministic
 * stub.
 */

export interface LocalSummarizeInput {
  readonly text: string;
  readonly maxTokens?: number;
  readonly style?: 'bullet' | 'paragraph' | 'headline';
}

export interface LocalClassifyInput<L extends string = string> {
  readonly text: string;
  readonly labels: readonly L[];
  readonly multi?: boolean;
}

export interface LocalLLMFallback {
  summarize(input: LocalSummarizeInput): Promise<{ summary: string }>;
  classify<L extends string>(
    input: LocalClassifyInput<L>,
  ): Promise<{ labels: readonly L[]; confidence: number }>;
}

/**
 * Deterministic stub used by tests + offline-dev. Not a real LLM —
 * summarize = first N words, classify = keyword overlap. Operators
 * override with an Ollama-backed implementation in production.
 */
export const stubLocalLLM: LocalLLMFallback = {
  async summarize({ text, maxTokens = 80, style }) {
    if (style === 'headline') {
      return { summary: text.split(/[.!?]/u)[0]?.trim().slice(0, maxTokens * 4) ?? '' };
    }
    const words = text.split(/\s+/u).filter(Boolean);
    const trimmed = words.slice(0, maxTokens).join(' ');
    if (style === 'bullet') {
      const chunks = trimmed.split(/[.;]\s+/u).filter((c) => c.trim().length > 0);
      return { summary: chunks.map((c) => `- ${c.trim()}`).join('\n') };
    }
    return { summary: trimmed };
  },
  async classify({ text, labels, multi = false }) {
    const lc = text.toLowerCase();
    const scored = labels.map((l) => ({
      label: l,
      score: lc.includes(l.toLowerCase()) ? 1 : 0,
    }));
    const hits = scored.filter((s) => s.score > 0);
    if (hits.length === 0) {
      return { labels: [labels[0] as typeof labels[number]], confidence: 0 };
    }
    const picked = multi ? hits.map((h) => h.label) : [hits[0]!.label];
    return { labels: picked, confidence: hits.length / labels.length };
  },
};
