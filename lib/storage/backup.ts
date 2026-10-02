// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Backing up and restoring the photo store. Photos are content addressed (`photos/<sha256>`), so a
 * backup can PROVE itself: every object's bytes must hash to the name it is stored under. A copy
 * that does not is reported as corrupt and never written. Pure over a tiny `ObjectStore` interface
 * so it is tested without a network; `scripts/backup/objects.ts` wires it to S3.
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ObjectStore {
  /** Every key under the prefix. */
  list(prefix: string): Promise<string[]>;
  get(key: string): Promise<{ body: Buffer; contentType?: string }>;
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const PREFIX = 'photos/';
const KEY = /^photos\/[0-9a-f]{64}$/;
const MANIFEST = 'manifest.json';

export const sha256Hex = (body: Buffer): string => createHash('sha256').update(body).digest('hex');
const nameOf = (key: string): string => key.slice(PREFIX.length);

export type Manifest = {
  readonly createdAt: string;
  /** key -> content type */
  readonly objects: Readonly<Record<string, string | null>>;
};

export type BackupReport = {
  readonly copied: number;
  readonly alreadyPresent: number;
  /** Objects whose bytes do not hash to their key: not copied. */
  readonly corrupt: string[];
  /** Keys under the prefix that are not `photos/<sha256>`: left alone, listed. */
  readonly unexpected: string[];
};

async function readManifest(dir: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** Copy every photo into `dir` (incremental: a verified file already there is kept). */
export async function backupObjects(store: ObjectStore, dir: string): Promise<BackupReport> {
  await mkdir(join(dir, 'photos'), { recursive: true });
  const prior = (await readManifest(dir))?.objects ?? {};
  const objects: Record<string, string | null> = { ...prior };
  let copied = 0;
  let alreadyPresent = 0;
  const corrupt: string[] = [];
  const unexpected: string[] = [];

  for (const key of await store.list(PREFIX)) {
    if (!KEY.test(key)) {
      unexpected.push(key);
      continue;
    }
    const target = join(dir, key);
    try {
      if (sha256Hex(await readFile(target)) === nameOf(key)) {
        alreadyPresent += 1;
        continue;
      }
    } catch {
      // not there yet
    }
    const { body, contentType } = await store.get(key);
    if (sha256Hex(body) !== nameOf(key)) {
      corrupt.push(key);
      continue;
    }
    await writeFile(`${target}.part`, body, { mode: 0o600 });
    await rename(`${target}.part`, target);
    objects[key] = contentType ?? null;
    copied += 1;
  }
  await writeFile(
    join(dir, MANIFEST),
    JSON.stringify({ createdAt: new Date().toISOString(), objects } satisfies Manifest, null, 2),
    { mode: 0o600 },
  );
  return { copied, alreadyPresent, corrupt, unexpected };
}

export type VerifyReport = {
  readonly files: number;
  readonly corrupt: string[];
  /** Hashes the caller expected (e.g. every photo the database references) that the backup lacks. */
  readonly missing: string[];
};

/** Re-hash every file in a backup directory; optionally check it holds all `expected` hashes. */
export async function verifyBackup(
  dir: string,
  expected: Iterable<string> = [],
): Promise<VerifyReport> {
  const corrupt: string[] = [];
  const present = new Set<string>();
  let names: string[] = [];
  try {
    names = await readdir(join(dir, 'photos'));
  } catch {
    // an empty or missing backup reports missing below
  }
  for (const name of names) {
    if (name.endsWith('.part')) {
      corrupt.push(`photos/${name}`);
      continue;
    }
    const ok =
      /^[0-9a-f]{64}$/.test(name) && sha256Hex(await readFile(join(dir, 'photos', name))) === name;
    if (ok) {
      present.add(name);
    } else {
      corrupt.push(`photos/${name}`);
    }
  }
  const missing = [...new Set(expected)].filter((hash) => !present.has(hash));
  return { files: present.size, corrupt, missing };
}

export type RestoreReport = { readonly uploaded: number; readonly alreadyPresent: number };

/** Upload every verified photo that the store lacks. Existing objects are never overwritten. */
export async function restoreObjects(store: ObjectStore, dir: string): Promise<RestoreReport> {
  const check = await verifyBackup(dir);
  if (check.corrupt.length > 0) {
    throw new Error(
      `The backup is not intact (${check.corrupt.length} corrupt file(s)); restore refused`,
    );
  }
  const manifest = (await readManifest(dir))?.objects ?? {};
  let uploaded = 0;
  let alreadyPresent = 0;
  for (const name of await readdir(join(dir, 'photos'))) {
    const key = `${PREFIX}${name}`;
    if (await store.exists(key)) {
      alreadyPresent += 1;
      continue;
    }
    await mkdir(dirname(join(dir, key)), { recursive: true });
    await store.put(key, await readFile(join(dir, key)), manifest[key] ?? undefined);
    uploaded += 1;
  }
  return { uploaded, alreadyPresent };
}
