/**
 * useSpaceMailbox.ts
 * React hook for reading and writing a single space mailbox
 * via the GitHub Contents API. Requires a GitHub PAT stored
 * in the app settings (same pattern as Studio-OS-Chat).
 *
 * Usage:
 *   const { inbox, send, refresh, isLoading, error } = useSpaceMailbox({
 *     spaceName: 'studio-os-chat',
 *     pat: settings.githubPat,
 *     repo: 'nothinginfinity/studio-os-spaces',
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type SpaceEnvelope,
  createEnvelope,
  serializeEnvelope,
  parseEnvelopes,
} from './envelope';

export interface UseSpaceMailboxOptions {
  /** Space ID matching registry.json — e.g. 'studio-os-chat' */
  spaceName: string;
  /** GitHub Personal Access Token with repo read/write scope */
  pat: string;
  /** Owner/repo containing the spaces/ directory */
  repo?: string;
  /** Poll interval in ms — set to 0 to disable polling */
  pollIntervalMs?: number;
}

export interface UseSpaceMailboxResult {
  /** Parsed envelopes from this space's inbox */
  inbox: SpaceEnvelope[];
  /** Parsed envelopes from this space's outbox */
  outbox: SpaceEnvelope[];
  /** Send a message to another space */
  send: (to: string, body: string, payload?: Record<string, unknown>, threadId?: string) => Promise<void>;
  /** Manually refresh inbox + outbox */
  refresh: () => Promise<void>;
  isLoading: boolean;
  error: string;
}

const DEFAULT_REPO = 'nothinginfinity/studio-os-spaces';
const GITHUB_API = 'https://api.github.com';

async function fetchFileContent(
  repo: string,
  path: string,
  pat: string
): Promise<{ content: string; sha: string }> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return { content: '', sha: '' };
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = typeof json.content === 'string'
    ? atob(json.content.replace(/\n/g, ''))
    : '';
  return { content, sha: json.sha ?? '' };
}

async function appendToFile(
  repo: string,
  path: string,
  pat: string,
  appendText: string,
  commitMessage: string
): Promise<void> {
  // Read current content + SHA
  const { content: current, sha } = await fetchFileContent(repo, path, pat);
  const next = current + '\n' + appendText + '\n';
  const encoded = btoa(unescape(encodeURIComponent(next)));

  const body: Record<string, unknown> = {
    message: commitMessage,
    content: encoded,
  };
  if (sha) body.sha = sha;

  const res = await fetch(`${GITHUB_API}/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub write error ${res.status}: ${await res.text()}`);
}

export function useSpaceMailbox({
  spaceName,
  pat,
  repo = DEFAULT_REPO,
  pollIntervalMs = 30_000,
}: UseSpaceMailboxOptions): UseSpaceMailboxResult {
  const [inbox, setInbox] = useState<SpaceEnvelope[]>([]);
  const [outbox, setOutbox] = useState<SpaceEnvelope[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inboxPath = `spaces/${spaceName}/inbox.md`;
  const outboxPath = `spaces/${spaceName}/outbox.md`;

  const refresh = useCallback(async () => {
    if (!pat) return;
    setIsLoading(true);
    setError('');
    try {
      const [inboxFile, outboxFile] = await Promise.all([
        fetchFileContent(repo, inboxPath, pat),
        fetchFileContent(repo, outboxPath, pat),
      ]);
      setInbox(parseEnvelopes(inboxFile.content));
      setOutbox(parseEnvelopes(outboxFile.content));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [pat, repo, inboxPath, outboxPath]);

  const send = useCallback(
    async (
      to: string,
      body: string,
      payload?: Record<string, unknown>,
      threadId?: string
    ) => {
      if (!pat) throw new Error('No GitHub PAT configured');
      const envelope = createEnvelope(spaceName, to, body, payload, threadId);
      const block = serializeEnvelope(envelope);
      await appendToFile(
        repo,
        outboxPath,
        pat,
        block,
        `msg(${spaceName}→${to}): ${envelope.id}`
      );
      setOutbox((prev) => [envelope, ...prev]);
    },
    [pat, repo, spaceName, outboxPath]
  );

  // Initial load
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Polling
  useEffect(() => {
    if (!pollIntervalMs || !pat) return;
    pollRef.current = setInterval(refresh, pollIntervalMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh, pollIntervalMs, pat]);

  return { inbox, outbox, send, refresh, isLoading, error };
}
