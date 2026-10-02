// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupObjects, type ObjectStore, restoreObjects, sha256Hex, verifyBackup } from './backup';

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType?: string }>();
  async list(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
  async get(key: string) {
    const found = this.objects.get(key);
    if (!found) {
      throw new Error('missing');
    }
    return found;
  }
  async put(key: string, body: Buffer, contentType?: string) {
    this.objects.set(key, { body, ...(contentType ? { contentType } : {}) });
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

const photo = (text: string) => {
  const body = Buffer.from(text);
  return { body, hash: sha256Hex(body), key: `photos/${sha256Hex(body)}` };
};

describe('photo store backup', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'takasats-backup-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('copies every photo, verifies it, and a second run copies nothing', async () => {
    const store = new MemoryStore();
    const a = photo('scale one');
    const b = photo('scale two');
    await store.put(a.key, a.body, 'image/jpeg');
    await store.put(b.key, b.body, 'image/png');

    expect(await backupObjects(store, dir)).toMatchObject({
      copied: 2,
      alreadyPresent: 0,
      corrupt: [],
    });
    expect(await backupObjects(store, dir)).toMatchObject({ copied: 0, alreadyPresent: 2 });
    expect(await verifyBackup(dir, [a.hash, b.hash])).toEqual({
      files: 2,
      corrupt: [],
      missing: [],
    });
  });

  it('never copies an object whose bytes do not hash to its key', async () => {
    const store = new MemoryStore();
    const good = photo('good');
    await store.put(good.key, good.body);
    await store.put(`photos/${'a'.repeat(64)}`, Buffer.from('tampered or truncated'));
    const report = await backupObjects(store, dir);
    expect(report.copied).toBe(1);
    expect(report.corrupt).toEqual([`photos/${'a'.repeat(64)}`]);
    expect((await verifyBackup(dir)).files).toBe(1);
  });

  it('lists keys that are not photos/<sha256> instead of silently copying them', async () => {
    const store = new MemoryStore();
    await store.put('photos/../../etc/passwd', Buffer.from('x'));
    await store.put('photos/not-a-hash', Buffer.from('x'));
    const report = await backupObjects(store, dir);
    expect(report.copied).toBe(0);
    expect(report.unexpected).toHaveLength(2);
  });

  it('verify catches a file changed after the backup and hashes the database needs but the backup lacks', async () => {
    const store = new MemoryStore();
    const a = photo('one');
    await store.put(a.key, a.body);
    await backupObjects(store, dir);
    await writeFile(join(dir, a.key), 'bit rot');
    const wanted = photo('referenced but never uploaded');
    const report = await verifyBackup(dir, [a.hash, wanted.hash]);
    expect(report.corrupt).toEqual([a.key]);
    expect(report.missing).toEqual([a.hash, wanted.hash]);
  });

  it('re-fetches a damaged local copy on the next backup run', async () => {
    const store = new MemoryStore();
    const a = photo('heal me');
    await store.put(a.key, a.body);
    await backupObjects(store, dir);
    await writeFile(join(dir, a.key), 'damaged');
    expect(await backupObjects(store, dir)).toMatchObject({ copied: 1 });
    expect(await readFile(join(dir, a.key))).toEqual(a.body);
  });

  it('restores into an empty store, keeps content types, and never overwrites an existing object', async () => {
    const source = new MemoryStore();
    const a = photo('alpha');
    const b = photo('beta');
    await source.put(a.key, a.body, 'image/webp');
    await source.put(b.key, b.body, 'image/jpeg');
    await backupObjects(source, dir);

    const target = new MemoryStore();
    await target.put(b.key, Buffer.from('already here, different bytes'), 'image/jpeg');
    expect(await restoreObjects(target, dir)).toEqual({ uploaded: 1, alreadyPresent: 1 });
    expect(target.objects.get(a.key)).toEqual({ body: a.body, contentType: 'image/webp' });
    expect(target.objects.get(b.key)?.body.toString()).toBe('already here, different bytes');
  });

  it('refuses to restore from a backup that is not intact', async () => {
    const store = new MemoryStore();
    const a = photo('x');
    await store.put(a.key, a.body);
    await backupObjects(store, dir);
    await writeFile(join(dir, a.key), 'corrupted');
    await expect(restoreObjects(new MemoryStore(), dir)).rejects.toThrow(/not intact/);
  });
});
