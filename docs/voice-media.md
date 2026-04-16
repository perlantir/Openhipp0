# Voice & Media (Phase 11)

Open Hipp0 ships a `MediaEngine` that unifies voice transcription, TTS,
image generation, and vision under a single API. All providers are
injectable; tests use the `LocalTtsStub` / `LocalVisionStub` for offline
determinism, production wires the OpenAI / Claude / Whisper providers.

## Configure the MediaEngine

```ts
import {
  MediaEngine,
  OpenAIWhisperProvider,
  WhisperCppProvider,
  OpenAITtsProvider,
  OpenAIImageProvider,
  ClaudeVisionProvider,
  OpenAIVisionProvider,
} from '@openhipp0/core';

const media = new MediaEngine({
  transcription: [
    new OpenAIWhisperProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    new WhisperCppProvider({ binaryPath: '/usr/local/bin/whisper', modelPath: '/models/base.en' }),
  ],
  tts: [new OpenAITtsProvider({ apiKey: process.env.OPENAI_API_KEY! })],
  imageGeneration: [new OpenAIImageProvider({ apiKey: process.env.OPENAI_API_KEY! })],
  vision: [
    new ClaudeVisionProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    new OpenAIVisionProvider({ apiKey: process.env.OPENAI_API_KEY! }),
  ],
});
```

Providers are tried in order; if the first fails, the engine falls back to the
next. If every provider fails, it throws `Hipp0MediaError`.

## Wire it into a bridge

```ts
import { TelegramBridge, withMediaEnrichment } from '@openhipp0/bridge';

const bridge = new TelegramBridge({ token: process.env.TELEGRAM_BOT_TOKEN! });
bridge.onMessage(
  withMediaEnrichment(
    async (msg) => {
      // msg.text now contains the transcribed voice or an "[image: …]" tag.
      await agent.handle(msg);
    },
    {
      engine: media,
      // Telegram needs a token-bearing fetch to reach its file CDN.
      async fetchAttachment(att) {
        const r = await fetch(att.url);
        return new Uint8Array(await r.arrayBuffer());
      },
    },
  ),
);
```

## Real-API tests

The providers' unit tests mock `fetch`. To run against real endpoints, set
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` and flip the `.skipIf(!process.env…)`
guard on each real-API test (none shipped in-tree — add them per project).
