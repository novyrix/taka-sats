// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Object storage for collection-event photos (FR-4.2, ROADMAP M3-10). Any
 * S3-compatible backend — MinIO in Docker, Cloudflare R2 on the hosted path.
 *
 * Config is environment-only (like the Lightning secrets): `S3_ENDPOINT`,
 * `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Read
 * lazily so a build / a test that never uploads doesn't need them set.
 *
 * Framework-free apart from the AWS SDK; server/worker only.
 */

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

export class StorageConfigError extends Error {
  constructor(missing: string) {
    super(`Object storage is not configured: ${missing} is unset`);
    this.name = 'StorageConfigError';
  }
}

type StorageEnv = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
};

function readEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  const get = (key: string): string => {
    const value = env[key];
    if (!value) {
      throw new StorageConfigError(key);
    }
    return value;
  };
  return {
    endpoint: get('S3_ENDPOINT'),
    bucket: get('S3_BUCKET'),
    region: env.S3_REGION ?? 'auto',
    accessKeyId: get('S3_ACCESS_KEY_ID'),
    secretAccessKey: get('S3_SECRET_ACCESS_KEY'),
  };
}

let cached: { client: S3Client; env: StorageEnv } | null = null;

function getClient(env?: NodeJS.ProcessEnv): { client: S3Client; env: StorageEnv } {
  if (!cached) {
    const resolved = readEnv(env);
    cached = {
      env: resolved,
      client: new S3Client({
        endpoint: resolved.endpoint,
        region: resolved.region,
        credentials: {
          accessKeyId: resolved.accessKeyId,
          secretAccessKey: resolved.secretAccessKey,
        },
        // MinIO and most self-hosted S3 need path-style addressing.
        forcePathStyle: true,
      }),
    };
  }
  return cached;
}

/** Test seam — drop the memoised client so the next call re-reads the env. */
export function resetStorageClient(): void {
  cached = null;
  bucketReady = null;
}

let bucketReady: Promise<void> | null = null;

/** Ensure the bucket exists (self-hosted MinIO ships none). Runs once per process. */
async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      const code = error instanceof S3ServiceException ? error.name : '';
      if (code === 'NotFound' || code === 'NoSuchBucket') {
        await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((e: unknown) => {
          const name = e instanceof S3ServiceException ? e.name : '';
          if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
            throw e;
          }
        });
      } else {
        throw error;
      }
    }
  })();
  return bucketReady;
}

export type PutPhotoResult = {
  /** The stored object key (`photos/<sha256>`). */
  readonly key: string;
  /** A URL the record can hold (`<endpoint>/<bucket>/<key>`). */
  readonly url: string;
};

/**
 * Store a photo under `photos/<sha256>` (content-addressed — a resend of the
 * same bytes overwrites the identical object, so this is idempotent).
 */
export async function putPhoto(
  bytes: Uint8Array,
  sha256: string,
  contentType: string,
  env?: NodeJS.ProcessEnv,
): Promise<PutPhotoResult> {
  const { client, env: cfg } = getClient(env);
  await ensureBucket(client, cfg.bucket);
  const key = `photos/${sha256}`;
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
    }),
  );
  return { key, url: `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${key}` };
}
