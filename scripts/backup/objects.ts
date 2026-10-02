// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Back up, restore and check the photo store (S3 / MinIO / Garage / R2). Photos are named by the
 * SHA-256 of their bytes, so every copy is verified against its own name.
 *
 *   tsx scripts/backup/objects.ts backup  <dir>   copy every photo into <dir> (incremental)
 *   tsx scripts/backup/objects.ts check   <dir>   re-hash every file; with DATABASE_URL also list
 *                                                 photos the database references that <dir> lacks
 *   tsx scripts/backup/objects.ts restore <dir>   upload what the bucket lacks (never overwrites)
 *
 * Uses the same S3_* variables as the app. Exit code: 0 ok, 1 problems found, 2 bad usage.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import {
  backupObjects,
  type ObjectStore,
  restoreObjects,
  verifyBackup,
} from '@/lib/storage/backup';

function s3Store(): ObjectStore {
  const need = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      console.error(`${name} is not set`);
      process.exit(2);
    }
    return value;
  };
  const bucket = need('S3_BUCKET');
  const client = new S3Client({
    endpoint: need('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'auto',
    credentials: {
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    },
    forcePathStyle: true,
  });
  return {
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        keys.push(...(page.Contents ?? []).map((o) => o.Key ?? '').filter(Boolean));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = Buffer.from(
        await (out.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
      );
      return { body, ...(out.ContentType ? { contentType: out.ContentType } : {}) };
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ...(contentType ? { ContentType: contentType } : {}),
        }),
      );
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
          return false;
        }
        if (error instanceof Error && error.name === 'NotFound') {
          return false;
        }
        throw error;
      }
    },
  };
}

async function referencedHashes(): Promise<string[] | null> {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  const { getDb, closeDb } = await import('@/lib/db/client');
  const { sql } = await import('drizzle-orm');
  try {
    const rows = await getDb().execute(
      sql`select distinct photo_sha256 as h from collection_events where photo_sha256 is not null`,
    );
    return rows.map((row) => String((row as { h: string }).h));
  } finally {
    await closeDb();
  }
}

async function main(): Promise<number> {
  const [command, dir] = process.argv.slice(2);
  if (!dir || !['backup', 'check', 'restore'].includes(command ?? '')) {
    console.error('Usage: objects.ts backup|check|restore <dir>');
    return 2;
  }

  if (command === 'backup') {
    const report = await backupObjects(s3Store(), dir);
    console.log(
      `backup: ${report.copied} copied, ${report.alreadyPresent} already present, ${report.corrupt.length} corrupt, ${report.unexpected.length} unexpected key(s)`,
    );
    for (const key of report.corrupt) {
      console.log(`  CORRUPT in the bucket (not copied): ${key}`);
    }
    return report.corrupt.length > 0 ? 1 : 0;
  }

  if (command === 'check') {
    const expected = await referencedHashes();
    const report = await verifyBackup(dir, expected ?? []);
    console.log(
      `check: ${report.files} verified file(s), ${report.corrupt.length} corrupt` +
        (expected
          ? `, ${report.missing.length} of ${expected.length} referenced photo(s) missing`
          : ' (no DATABASE_URL: references not compared)'),
    );
    for (const name of report.corrupt) {
      console.log(`  CORRUPT: ${name}`);
    }
    for (const hash of report.missing.slice(0, 20)) {
      console.log(`  MISSING from the backup: ${hash}`);
    }
    return report.corrupt.length > 0 || report.missing.length > 0 ? 1 : 0;
  }

  const report = await restoreObjects(s3Store(), dir);
  console.log(
    `restore: ${report.uploaded} uploaded, ${report.alreadyPresent} already in the bucket`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
