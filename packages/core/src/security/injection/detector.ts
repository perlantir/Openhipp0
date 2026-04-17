/**
 * Pattern detector — scans a string for shapes common to prompt-injection
 * attempts. Emits structured matches; callers decide whether to log,
 * alert, or surface them in a UI. The detector NEVER blocks; pattern
 * libraries die against novel attacks. Spotlighting + quarantine + the
 * policy engine are the actual defenses.
 */

export type DetectionCategory =
  | 'instruction-override'
  | 'roleplay-hijack'
  | 'tool-coercion'
  | 'secret-exfil'
  | 'system-prompt-probe'
  | 'delimiter-forgery';

export interface Detection {
  readonly category: DetectionCategory;
  readonly pattern: string;
  /** Zero-based index of the match in the scanned text. */
  readonly index: number;
  readonly snippet: string;
}

interface PatternDef {
  readonly category: DetectionCategory;
  readonly pattern: RegExp;
  readonly label: string;
}

const PATTERNS: readonly PatternDef[] = [
  {
    category: 'instruction-override',
    pattern: /\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules?)\b/iu,
    label: 'ignore-previous-instructions',
  },
  {
    category: 'instruction-override',
    pattern: /\b(disregard|override|forget)\s+(your\s+)?(instructions|system\s+prompt|rules?)\b/iu,
    label: 'override-system-prompt',
  },
  {
    category: 'roleplay-hijack',
    pattern: /\byou\s+are\s+now\s+(?:a\s+|an\s+)?[a-z\s-]{3,60}\b/iu,
    label: 'you-are-now',
  },
  {
    category: 'roleplay-hijack',
    pattern: /\b(act|pretend|behave)\s+as\s+if\s+you\s+(?:are|were)\b/iu,
    label: 'act-as-if',
  },
  {
    category: 'tool-coercion',
    pattern: /\bcall\s+the\s+\w+\s+tool\s+with\b/iu,
    label: 'tool-call-coercion',
  },
  {
    category: 'secret-exfil',
    pattern: /\b(show|print|reveal|echo|leak|dump)\s+(your\s+)?(system\s+prompt|initial\s+prompt|instructions|api\s+keys?|secrets?|tokens?)\b/iu,
    label: 'print-system-prompt',
  },
  {
    category: 'system-prompt-probe',
    pattern: /\brepeat\s+(the\s+)?(text\s+)?above\b/iu,
    label: 'repeat-above',
  },
  {
    category: 'delimiter-forgery',
    pattern: /<<\s*(END\s+)?UNTRUSTED[\s>]/iu,
    label: 'forged-untrusted-delimiter',
  },
  {
    category: 'delimiter-forgery',
    pattern: /```\s*system\b/iu,
    label: 'forged-system-fence',
  },
];

export interface ScanOptions {
  /** Maximum chars of context around each match returned in `snippet`. Default 80. */
  readonly snippetWindow?: number;
  /** Stop after this many detections. Useful for large documents. */
  readonly maxDetections?: number;
}

export function scanForInjection(text: string, opts: ScanOptions = {}): readonly Detection[] {
  const window = opts.snippetWindow ?? 80;
  const max = opts.maxDetections ?? Number.MAX_SAFE_INTEGER;
  const out: Detection[] = [];
  for (const def of PATTERNS) {
    const m = text.match(def.pattern);
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - Math.floor(window / 2));
      const end = Math.min(text.length, m.index + m[0].length + Math.floor(window / 2));
      out.push({
        category: def.category,
        pattern: def.label,
        index: m.index,
        snippet: text.slice(start, end),
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** True if any detection fires — advisory only, never used to block. */
export function looksSuspicious(text: string): boolean {
  return scanForInjection(text, { maxDetections: 1 }).length > 0;
}
