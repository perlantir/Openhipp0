/**
 * Line-level upsert for `.env` files. Preserves existing lines (comments,
 * other keys, blank lines); replaces only the line whose KEY matches. Writes
 * with mode 600. Env path is caller-supplied — typically
 * `${defaultConfigDir()}/.env` or the value of `HIPP0_ENV_PATH`.
 *
 * Defense: rejects keys that don't match `^[A-Z0-9_]+$` so a malformed
 * request can't smuggle a newline into the file.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export function defaultEnvPath(): string {
  if (process.env['HIPP0_ENV_PATH']) return process.env['HIPP0_ENV_PATH'];
  const home = process.env['HIPP0_HOME'] ?? path.join(homedir(), '.hipp0');
  return path.join(home, '.env');
}

export async function upsertEnvKey(
  envPath: string,
  key: string,
  value: string,
): Promise<void> {
  if (!ENV_KEY_RE.test(key)) {
    throw new Error(`invalid env key: ${key}`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error('env value cannot contain newlines');
  }
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const lines = content === '' ? [] : content.split('\n');
  const hadTrailingNewline = content.endsWith('\n');
  const prefix = key + '=';
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && line.startsWith(prefix)) {
      replaced = true;
      return prefix + value;
    }
    return line;
  });
  if (!replaced) {
    if (hadTrailingNewline && next.length > 0 && next[next.length - 1] === '') {
      next[next.length - 1] = prefix + value;
    } else {
      next.push(prefix + value);
    }
  }
  let out = next.join('\n');
  if (!out.endsWith('\n')) out += '\n';
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  await fs.writeFile(envPath, out, { mode: 0o600 });
  await fs.chmod(envPath, 0o600).catch(() => undefined);
}
