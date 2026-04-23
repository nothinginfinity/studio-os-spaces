/**
 * coordinator.ts
 * Multi-space routing logic.
 * Reads each registered space's outbox and routes pending envelopes
 * to their target space's inbox via the GitHub API.
 *
 * This can be run as a scheduled GitHub Action, a Netlify/Vercel
 * edge function, or triggered manually from the UI.
 */

import registry from '../registry.json';
import { parseEnvelopes, serializeEnvelope } from './envelope';

const GITHUB_API = 'https://api.github.com';

interface CoordinatorOptions {
  pat: string;
  repo?: string;
  dryRun?: boolean;
}

interface RouteResult {
  envelopeId: string;
  from: string;
  to: string;
  status: 'routed' | 'skipped' | 'error';
  error?: string;
}

async function getFile(repo: string, path: string, pat: string) {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return { content: '', sha: '' };
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  const json = await res.json();
  return {
    content: atob((json.content as string).replace(/\n/g, '')),
    sha: json.sha as string,
  };
}

async function putFile(
  repo: string,
  path: string,
  pat: string,
  content: string,
  sha: string,
  message: string
) {
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, content: encoded, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`);
}

/**
 * Run one coordination pass:
 * - For each space, read outbox
 * - Find envelopes with status 'pending'
 * - Append them to the target space's inbox
 * - Mark them 'delivered' in the outbox
 */
export async function runCoordinator({
  pat,
  repo = 'nothinginfinity/studio-os-spaces',
  dryRun = false,
}: CoordinatorOptions): Promise<RouteResult[]> {
  const results: RouteResult[] = [];
  const spaceMap = Object.fromEntries(registry.spaces.map((s) => [s.id, s]));

  for (const space of registry.spaces) {
    let outboxContent: string;
    let outboxSha: string;

    try {
      const file = await getFile(repo, space.outboxPath, pat);
      outboxContent = file.content;
      outboxSha = file.sha;
    } catch (err) {
      console.error(`[coordinator] Failed to read outbox for ${space.id}:`, err);
      continue;
    }

    const envelopes = parseEnvelopes(outboxContent);
    const pending = envelopes.filter((e) => e.status === 'pending');
    if (!pending.length) continue;

    for (const env of pending) {
      const target = spaceMap[env.to];
      if (!target) {
        results.push({ envelopeId: env.id, from: env.from, to: env.to, status: 'error', error: `Unknown target space: ${env.to}` });
        continue;
      }

      try {
        if (!dryRun) {
          // Append to target inbox
          const inboxFile = await getFile(repo, target.inboxPath, pat);
          const delivered = { ...env, status: 'delivered' as const };
          const newInbox = inboxFile.content + '\n' + serializeEnvelope(delivered) + '\n';
          await putFile(repo, target.inboxPath, pat, newInbox, inboxFile.sha, `deliver(${env.from}→${env.to}): ${env.id}`);
        }
        results.push({ envelopeId: env.id, from: env.from, to: env.to, status: 'routed' });
      } catch (err) {
        results.push({
          envelopeId: env.id, from: env.from, to: env.to, status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}
