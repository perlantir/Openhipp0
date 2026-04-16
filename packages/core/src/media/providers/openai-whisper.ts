/**
 * OpenAI Whisper provider — /v1/audio/transcriptions (multipart/form-data).
 *
 * Accepts a Buffer/Uint8Array or a file path. Returns text + language +
 * duration when available (verbose_json response_format).
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { fetchWithRetry } from '../../integrations/http.js';
import {
  Hipp0MediaError,
  type TranscribeOptions,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
} from '../types.js';

const DEFAULT_URL = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_MODEL = 'whisper-1';

export interface OpenAIWhisperOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export class OpenAIWhisperProvider implements TranscriptionProvider {
  readonly name = 'openai-whisper';

  constructor(private readonly opts: OpenAIWhisperOptions) {}

  async transcribe(
    input: TranscriptionInput,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    const { data, filename, mimeType } = await toBuffer(input);

    const form = new FormData();
    form.set('model', this.opts.model ?? DEFAULT_MODEL);
    form.set('response_format', 'verbose_json');
    if (opts.language) form.set('language', opts.language);
    if (opts.prompt) form.set('prompt', opts.prompt);
    form.set(
      'file',
      new Blob([new Uint8Array(data)], { type: mimeType ?? 'audio/ogg' }),
      filename,
    );

    const doFetch = this.opts.fetch ?? fetch;
    const url = `${(this.opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, '')}`;
    const resp = await fetchWithRetry(() =>
      doFetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
      }),
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Hipp0MediaError(
        'HIPP0_WHISPER_HTTP_ERROR',
        `OpenAI Whisper ${resp.status}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as Record<string, unknown>;
    const text = typeof json['text'] === 'string' ? json['text'] : '';
    const language = typeof json['language'] === 'string' ? json['language'] : undefined;
    const duration = typeof json['duration'] === 'number' ? json['duration'] : undefined;
    const result: TranscriptionResult = { text, raw: json };
    if (language !== undefined) result.language = language;
    if (duration !== undefined) result.duration = duration;
    return result;
  }
}

async function toBuffer(input: TranscriptionInput): Promise<{
  data: Uint8Array;
  filename: string;
  mimeType?: string;
}> {
  if (input.kind === 'buffer') {
    return {
      data: input.data,
      filename: input.filename,
      ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
    };
  }
  const data = await readFile(input.path);
  return {
    data,
    filename: basename(input.path),
    ...(input.mimeType !== undefined && { mimeType: input.mimeType }),
  };
}

/**
 * whisper.cpp fallback — shells out to a local `whisper` binary if installed.
 * Deliberately a thin wrapper so it can be stubbed in tests; not called
 * automatically. Callers construct it with a resolved binary path.
 */

export interface WhisperCppOptions {
  binaryPath: string;
  modelPath: string;
  /** Injected child_process.exec for tests. */
  exec?: (
    cmd: string,
    opts: { maxBuffer?: number },
  ) => Promise<{ stdout: string; stderr: string }>;
}

export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = 'whisper-cpp';

  constructor(private readonly opts: WhisperCppOptions) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const path = input.kind === 'path' ? input.path : await writeTempBuffer(input.data, input.filename);
    const { stdout } = await this.runBinary(path);
    return { text: stdout.trim() };
  }

  private async runBinary(audioPath: string): Promise<{ stdout: string; stderr: string }> {
    const cmd = `${this.opts.binaryPath} -m ${this.opts.modelPath} -f ${audioPath} --no-prints`;
    if (this.opts.exec) return this.opts.exec(cmd, { maxBuffer: 16 * 1024 * 1024 });
    const { exec } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      exec(cmd, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Hipp0MediaError('HIPP0_WHISPER_CPP_FAILED', err.message));
        else resolve({ stdout, stderr });
      });
    });
  }
}

async function writeTempBuffer(data: Uint8Array, filename: string): Promise<string> {
  const { writeFile, mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'hipp0-whisper-'));
  const p = join(dir, filename);
  await writeFile(p, data);
  return p;
}
