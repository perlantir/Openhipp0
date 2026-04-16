#!/usr/bin/env node
// packages/relay/bin/relay.js
// Zero-deps launcher. Reads HIPP0_RELAY_CREDS (JSON array of
// {clientId, tokenSha256, label}) + HIPP0_RELAY_PORT from env,
// spins up the RelayServer, logs one line per event.

import { readFileSync } from 'node:fs';
import { MemoryCredentialStore, RelayServer } from '../dist/index.js';

function loadCreds() {
  const raw = process.env['HIPP0_RELAY_CREDS_FILE']
    ? readFileSync(process.env['HIPP0_RELAY_CREDS_FILE'], 'utf-8')
    : process.env['HIPP0_RELAY_CREDS'];
  if (!raw) {
    console.error('HIPP0_RELAY_CREDS or HIPP0_RELAY_CREDS_FILE required.');
    console.error(
      'Each credential: {"clientId":"srv-1","tokenSha256":"<sha256>","label":"server"}',
    );
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('invalid credentials JSON:', err);
    process.exit(1);
  }
}

const store = new MemoryCredentialStore();
for (const cred of loadCreds()) await store.put(cred);

const relay = new RelayServer({
  port: Number(process.env['HIPP0_RELAY_PORT'] ?? 3101),
  host: process.env['HIPP0_RELAY_HOST'] ?? '0.0.0.0',
  credentials: store,
});

relay.on('client:connect', ({ clientId }) => console.log(`+ ${clientId}`));
relay.on('client:disconnect', ({ clientId }) => console.log(`- ${clientId}`));
relay.on('envelope:delivered', ({ from, to, msgId }) =>
  console.log(`→ ${from} → ${to} (${msgId})`),
);
relay.on('envelope:buffered', ({ from, to, msgId }) =>
  console.log(`· ${from} → ${to} buffered (${msgId})`),
);
relay.on('error', ({ clientId, err }) => console.error(`! ${clientId}`, err.message));

await relay.listen();
console.log(`Open Hipp0 relay listening on ${process.env['HIPP0_RELAY_HOST'] ?? '0.0.0.0'}:${process.env['HIPP0_RELAY_PORT'] ?? 3101}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`\nShutting down (${sig})…`);
    await relay.close();
    process.exit(0);
  });
}
