# @openhipp0/relay

Standalone WebSocket relay for Open Hipp0 mobile ↔ server communication.

**Not a hosted service.** The Open Hipp0 project runs **no** public relay. This package is published so anyone can run one themselves — on a $5 VPS, on a home NAS, or inside a corporate network.

## Threat model

The relay is a stateless router. It accepts authenticated WebSocket clients, forwards opaque envelopes between them, and buffers briefly for offline peers. **It never decrypts payloads** — every envelope is NaCl-box sealed by the peers (server ↔ mobile) using keys exchanged during pairing (see `@openhipp0/core/pairing`).

A compromised or malicious relay operator can:

- Observe metadata (who talks to whom, when, how often, envelope sizes)
- Drop / delay / reorder messages (denial of service)
- Refuse service entirely

A compromised or malicious relay operator **cannot**:

- Read message content
- Forge messages (NaCl box authenticates)
- Replay old messages (peers include timestamps in their sealed payloads)

If you don't trust the relay operator, you trade DoS resistance for confidentiality — which is the whole point of running one yourself.

## Running

```bash
# Option A — Docker (30-second deploy)
cd packages/relay
docker compose up -d

# Option B — directly
pnpm --filter @openhipp0/relay build
HIPP0_RELAY_PORT=3101 \
HIPP0_RELAY_CREDS='[{"clientId":"srv-1","tokenSha256":"<sha256-hex>","label":"server"}]' \
node packages/relay/bin/relay.js
```

## Credentials

Each client (server + each paired mobile) presents a `clientId` + pre-shared `token`. The relay stores only `sha256(token)`, never plaintext.

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Hash it for the relay's credential store:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('<paste-token>').digest('hex'))"
```

Ship the plaintext to the client (server / mobile) via the pairing flow (encrypted), and keep only the hash in `creds.json`:

```json
[
  { "clientId": "srv-1",    "tokenSha256": "…", "label": "my-server" },
  { "clientId": "mobile-1", "tokenSha256": "…", "label": "iPhone"    }
]
```

## Wire protocol

Clients connect: `wss://relay.example/?clientId=srv-1&token=<plaintext>`

**Outbound frame** (client → relay):

```json
{
  "type": "envelope",
  "to": "mobile-1",
  "from": "srv-1",
  "payload": "<base64 NaCl-box envelope>",
  "msgId": "client-generated-id"
}
```

**Inbound frame** (relay → client) — identical shape, forwarded verbatim.

Other frames: `{"type": "ping"}` ↔ `{"type": "pong"}`, `{"type": "hello", "clientId": "…"}` on successful auth.

## Community registry

Users who want to use a relay without running their own can browse the community-maintained registry at **github.com/openhipp0/community-relays**. The Open Hipp0 project does not curate that list — trust each operator individually.

## Not included

- Persistence across restarts. Buffered envelopes are RAM-only with a 60-second TTL — if the relay restarts, any undelivered messages are lost. Peers retry on reconnect.
- TLS termination. Run behind a reverse proxy (Caddy / Cloudflare Tunnel / nginx) for HTTPS.
- Metrics / observability beyond stdout logs. Add your own if needed.

## License

MIT — see repo root.
