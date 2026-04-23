/**
 * envelope.ts
 * Signed envelope format for Studio-OS space-to-space messaging.
 * Each message is wrapped in a SpaceEnvelope before being appended
 * to an outbox.md file via the GitHub API.
 */

export type EnvelopeStatus = 'pending' | 'delivered' | 'read' | 'error';

export interface SpaceEnvelope {
  /** Unique envelope ID — use uid() */
  id: string;
  /** Optional thread grouping ID */
  threadId?: string;
  /** Sending space ID — must match registry.json */
  from: string;
  /** Target space ID — must match registry.json */
  to: string;
  /** ISO timestamp of creation */
  sentAt: string;
  /** Plaintext or markdown message body */
  body: string;
  /** Optional structured payload (tool args, file refs, etc.) */
  payload?: Record<string, unknown>;
  /** Delivery status — set by coordinator */
  status: EnvelopeStatus;
}

/** Create a new outbound envelope */
export function createEnvelope(
  from: string,
  to: string,
  body: string,
  payload?: Record<string, unknown>,
  threadId?: string
): SpaceEnvelope {
  return {
    id: uid(),
    threadId,
    from,
    to,
    sentAt: new Date().toISOString(),
    body,
    payload,
    status: 'pending',
  };
}

/** Serialize an envelope to a markdown block for appending to outbox.md */
export function serializeEnvelope(env: SpaceEnvelope): string {
  const payloadBlock = env.payload
    ? `\n\`\`\`json\n${JSON.stringify(env.payload, null, 2)}\n\`\`\``
    : '';
  return [
    `---`,
    `<!-- envelope:${env.id} -->`,
    `**From:** ${env.from}  `,
    `**To:** ${env.to}  `,
    `**Sent:** ${env.sentAt}  `,
    env.threadId ? `**Thread:** ${env.threadId}  ` : null,
    `**Status:** ${env.status}`,
    ``,
    env.body,
    payloadBlock,
    ``,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/** Parse envelopes out of an inbox/outbox markdown file */
export function parseEnvelopes(markdown: string): SpaceEnvelope[] {
  const blocks = markdown.split(/^---$/m).map((b) => b.trim()).filter(Boolean);
  const envelopes: SpaceEnvelope[] = [];

  for (const block of blocks) {
    const idMatch = block.match(/<!-- envelope:([\w-]+) -->/);
    const fromMatch = block.match(/\*\*From:\*\* ([\w-]+)/);
    const toMatch = block.match(/\*\*To:\*\* ([\w-]+)/);
    const sentMatch = block.match(/\*\*Sent:\*\* (.+)/);
    const threadMatch = block.match(/\*\*Thread:\*\* ([\w-]+)/);
    const statusMatch = block.match(/\*\*Status:\*\* (\w+)/);

    if (!idMatch || !fromMatch || !toMatch || !sentMatch) continue;

    const bodyStart = block.indexOf('\n\n');
    const body = bodyStart !== -1 ? block.slice(bodyStart).trim() : '';

    envelopes.push({
      id: idMatch[1],
      from: fromMatch[1],
      to: toMatch[1],
      sentAt: sentMatch[1].trim(),
      threadId: threadMatch?.[1],
      status: (statusMatch?.[1] ?? 'pending') as EnvelopeStatus,
      body,
    });
  }

  return envelopes;
}

/** Simple unique ID — no external deps */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
