/**
 * CLI bridge — readline-based interactive terminal.
 *
 * Each line from stdin becomes an IncomingMessage. Responses are written to
 * stdout. Buttons are rendered as "[1] label  [2] label" with the user
 * choosing by number on the next prompt.
 *
 * The injectable `input` / `output` streams default to process.stdin / stdout
 * but tests pass PassThrough streams so assertions stay deterministic.
 */

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import {
  Hipp0BridgeNotConnectedError,
  type BridgeCapabilities,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingMessage,
} from './types.js';

const CLI_PLATFORM = 'cli' as const;

export interface CliBridgeOptions {
  input?: Readable;
  output?: Writable;
  /** Shown before each input line. Default: 'you> '. */
  prompt?: string;
  /** Fixed user identity. Default: { id: 'cli:local', name: 'local' }. */
  userId?: string;
  userName?: string;
}

export class CliBridge implements MessageBridge {
  readonly platform = CLI_PLATFORM;
  private rl: ReadlineInterface | undefined;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly prompt: string;
  private readonly userId: string;
  private readonly userName: string;
  private readonly onLine = (line: string): void => this.handleLine(line);

  constructor(opts: CliBridgeOptions = {}) {
    this.input = opts.input ?? process.stdin;
    this.output = opts.output ?? process.stdout;
    this.prompt = opts.prompt ?? 'you> ';
    this.userId = opts.userId ?? 'cli:local';
    this.userName = opts.userName ?? 'local';
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.rl = createInterface({ input: this.input, output: this.output, terminal: false });
    this.rl.on('line', this.onLine);
    this.connected = true;
    this.writeLine(`(connected — type a message and hit enter; Ctrl+C to quit)`);
    this.writePrompt();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.rl?.off('line', this.onLine);
    this.rl?.close();
    this.rl = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  async send(_channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(CLI_PLATFORM);
    this.writeLine(`\nagent> ${content.text}`);
    if (content.buttons && content.buttons.length > 0) {
      const rendered = content.buttons.map((b, i) => `[${i + 1}] ${b.label}`).join('  ');
      this.writeLine(`choose: ${rendered}  (or type free text)`);
    }
    if (content.attachments && content.attachments.length > 0) {
      for (const a of content.attachments) {
        this.writeLine(`  📎 ${a.filename}${a.url ? ` (${a.url})` : ''}`);
      }
    }
    this.writePrompt();
  }

  getCapabilities(): BridgeCapabilities {
    return {
      files: false,
      buttons: true, // rendered as text, but usable
      threads: false,
      slashCommands: false,
      maxMessageBytes: 4000,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private handleLine(line: string): void {
    const text = line.trimEnd();
    if (text.length === 0) {
      this.writePrompt();
      return;
    }
    const msg: IncomingMessage = {
      platform: CLI_PLATFORM,
      id: `cli_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      channel: { id: 'stdio', name: 'stdio', isDM: true },
      user: { id: this.userId, name: this.userName, isAdmin: true },
      text,
      timestamp: Date.now(),
    };
    for (const h of this.handlers) {
      try {
        const result = h(msg);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) {
      try {
        h(err);
      } catch {
        /* don't re-throw from error handler */
      }
    }
  }

  private writeLine(s: string): void {
    this.output.write(`${s}\n`);
  }

  private writePrompt(): void {
    this.output.write(this.prompt);
  }
}
