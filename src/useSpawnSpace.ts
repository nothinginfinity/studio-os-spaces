/**
 * useSpawnSpace.ts
 * React hook for Studio-OS-Chat.
 * Submits a spawn.json to studio-os-spaces via the GitHub API,
 * triggering the spawn-space GitHub Action automatically.
 *
 * Usage:
 *   const { spawn, isSpawning, result, error } = useSpawnSpace({ pat, repo });
 *   await spawn({ id: 'my-space', displayName: 'My Space', description: '...', peers: ['studio-os'] });
 */

import { useState, useCallback } from 'react';

export interface SpawnManifest {
  id: string;
  displayName: string;
  description: string;
  role?: 'peer' | 'worker' | 'orchestrator' | 'observer';
  context?: string;
  repo?: string;
  sources?: string[];
  peers?: string[];
  peerRoutes?: Array<{ spaceId: string; label?: string }>;
  systemPromptExtra?: string;
}

export interface SpawnResult {
  spaceId: string;
  spawnPath: string;
  commitUrl: string;
  instructionsUrl: string;
  status: 'triggered' | 'error';
}

export interface UseSpawnSpaceOptions {
  /** GitHub PAT with repo read/write — same PAT used by useSpaceMailbox */
  pat: string;
  /** Defaults to nothinginfinity/studio-os-spaces */
  repo?: string;
  /** Defaults to main */
  branch?: string;
}

export function useSpawnSpace(options: UseSpawnSpaceOptions) {
  const {
    pat,
    repo = 'nothinginfinity/studio-os-spaces',
    branch = 'main',
  } = options;

  const [isSpawning, setIsSpawning] = useState(false);
  const [result, setResult] = useState<SpawnResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const spawn = useCallback(
    async (manifest: SpawnManifest): Promise<SpawnResult | null> => {
      setIsSpawning(true);
      setError(null);
      setResult(null);

      const spawnPath = `spaces/${manifest.id}/spawn.json`;
      const apiBase = `https://api.github.com/repos/${repo}`;
      const headers = {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      try {
        // Check if file already exists (need SHA to update)
        let existingSha: string | undefined;
        const checkRes = await fetch(`${apiBase}/contents/${spawnPath}?ref=${branch}`, { headers });
        if (checkRes.ok) {
          const existing = await checkRes.json();
          existingSha = existing.sha;
        }

        // Encode content as base64
        const content = btoa(
          unescape(encodeURIComponent(JSON.stringify(manifest, null, 2)))
        );

        // Commit spawn.json — this triggers the GitHub Action
        const commitBody: Record<string, unknown> = {
          message: `feat(spawn): spawn space ${manifest.id}`,
          content,
          branch,
        };
        if (existingSha) commitBody.sha = existingSha;

        const commitRes = await fetch(`${apiBase}/contents/${spawnPath}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(commitBody),
        });

        if (!commitRes.ok) {
          const err = await commitRes.json();
          throw new Error(err.message || 'Failed to commit spawn.json');
        }

        const commitData = await commitRes.json();
        const commitUrl = commitData.commit?.html_url ?? `https://github.com/${repo}/commits/${branch}`;
        const instructionsUrl = `https://github.com/${repo}/blob/${branch}/spaces/${manifest.id}/INSTRUCTIONS.md`;

        const spawnResult: SpawnResult = {
          spaceId: manifest.id,
          spawnPath,
          commitUrl,
          instructionsUrl,
          status: 'triggered',
        };

        setResult(spawnResult);
        return spawnResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return null;
      } finally {
        setIsSpawning(false);
      }
    },
    [pat, repo, branch]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { spawn, isSpawning, result, error, reset };
}
