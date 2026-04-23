# studio-os-spaces

**Multi-space coordination layer for Studio-OS.**

This repo is the backbone of the Studio-OS messaging network. Every Perplexity Space in the ecosystem has a mailbox here — an `inbox.md` and an `outbox.md` stored as plain markdown files in Git. Spaces communicate by appending signed envelopes to their outbox; the coordinator routes them to the right inbox.

The Alice/Bob test proved this works. This repo makes it a first-class, multi-space protocol.

---

## How It Works

```
┌─────────────────────┐        ┌──────────────────────────────┐
│  Perplexity Space A │        │   studio-os-spaces (GitHub)  │
│  (studio-os-chat)   │        │                              │
│                     │ write  │  spaces/studio-os-chat/      │
│  useSpaceMailbox ───┼───────▶│    outbox.md   ◀── appended  │
│                     │        │    inbox.md    ──▶ polled    │
└─────────────────────┘        │                              │
                                │         coordinator.ts       │
┌─────────────────────┐        │         reads outboxes       │
│  Perplexity Space B │        │         routes envelopes     │
│  (studio-os)        │        │         writes to inboxes    │
│                     │ read   │                              │
│  useSpaceMailbox ◀──┼────────│  spaces/studio-os/           │
│                     │        │    inbox.md    ◀── delivered  │
└─────────────────────┘        └──────────────────────────────┘
```

### The Protocol

1. **Space A** calls `send(to, body)` via `useSpaceMailbox`
2. An envelope is created with a unique ID, timestamp, `from`, `to`, and `status: pending`
3. The envelope is serialized to markdown and **appended to `spaces/[A]/outbox.md`** via the GitHub API
4. The **coordinator** reads all outboxes, finds `pending` envelopes, and appends them to the target's **inbox.md** with `status: delivered`
5. **Space B** polls its `inbox.md` and receives the message

Every message is a Git commit. The full history is durable, inspectable, and branchable.

---

## Repository Structure

```
studio-os-spaces/
├── registry.json               ← All known spaces + their routes
├── spaces/
│   ├── studio-os-chat/
│   │   ├── inbox.md            ← Messages arriving for studio-os-chat
│   │   └── outbox.md           ← Messages sent by studio-os-chat
│   └── studio-os/
│       ├── inbox.md
│       └── outbox.md
└── src/
    ├── envelope.ts             ← SpaceEnvelope type, serialize/parse
    ├── useSpaceMailbox.ts      ← React hook for read/write/poll
    └── coordinator.ts          ← Multi-space routing logic
```

---

## Adding a New Space

1. Add an entry to `registry.json`:
```json
{
  "id": "my-new-space",
  "displayName": "My New Space",
  "description": "What this space does.",
  "inboxPath": "spaces/my-new-space/inbox.md",
  "outboxPath": "spaces/my-new-space/outbox.md",
  "repo": "nothinginfinity/studio-os-spaces",
  "status": "active"
}
```
2. Create `spaces/my-new-space/inbox.md` and `outbox.md` (copy from an existing space)
3. Use `useSpaceMailbox({ spaceName: 'my-new-space', pat })` in your app

That's it. The coordinator will automatically pick up its outbox on the next pass.

---

## Envelope Format

Each message in an inbox or outbox file looks like this:

```markdown
---
<!-- envelope:abc123def456 -->
**From:** studio-os-chat  
**To:** studio-os  
**Sent:** 2026-04-23T14:00:00.000Z  
**Thread:** thread-xyz  
**Status:** delivered

Hey studio-os, here is a new chat session ready for coordination.

```json
{ "sessionId": "sess-abc", "title": "My Chat" }
```
```

---

## useSpaceMailbox Hook

```ts
import { useSpaceMailbox } from './src/useSpaceMailbox';

const { inbox, outbox, send, refresh, isLoading, error } = useSpaceMailbox({
  spaceName: 'studio-os-chat',  // your space ID from registry.json
  pat: settings.githubPat,      // GitHub PAT with repo read/write
  repo: 'nothinginfinity/studio-os-spaces',
  pollIntervalMs: 30_000,       // poll every 30s, or 0 to disable
});

// Send a message to another space
await send('studio-os', 'Hello from chat!', { sessionId: 'abc' });

// inbox is SpaceEnvelope[] — read messages from other spaces
// outbox is SpaceEnvelope[] — messages you've sent
```

---

## Running the Coordinator

The coordinator can be triggered:
- **Manually** from the Studio-OS UI (a "Sync Spaces" button)
- **Automatically** via a GitHub Actions cron job (every 5 min)
- **On push** via a GitHub Actions workflow trigger

```ts
import { runCoordinator } from './src/coordinator';

const results = await runCoordinator({
  pat: process.env.GITHUB_PAT,
  repo: 'nothinginfinity/studio-os-spaces',
});

console.log(results);
// [{ envelopeId: 'abc123', from: 'studio-os-chat', to: 'studio-os', status: 'routed' }]
```

---

## Registered Spaces

| Space ID | Display Name | Repo | Status |
|---|---|---|---|
| `studio-os-chat` | Studio OS Chat | nothinginfinity/Studio-OS-Chat | active |
| `studio-os` | Studio OS | nothinginfinity/studio-os-spaces | active |

Add more spaces via `registry.json` — no code changes required.

---

## Connection to Studio-OS-Chat

`useSpaceMailbox` is a drop-in hook for the existing `Studio-OS-Chat` repo. Add it alongside `useChat` in `App.tsx`:

```ts
const mailbox = useSpaceMailbox({
  spaceName: 'studio-os-chat',
  pat: settings.githubPat,
});
```

The GitHub PAT is already handled by `GitHubSettings.tsx` in that repo — no new auth infrastructure needed.
