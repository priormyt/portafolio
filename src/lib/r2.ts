import { AwsClient } from 'aws4fetch';
import type { Env } from './sesiones';

type R2Env = Env & {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
};

export function r2Client(env: R2Env): { aws: AwsClient; bucket: string; endpoint: string } {
  const missing: string[] = [];
  if (!env.R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
  if (!env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!env.R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME');
  if (missing.length) throw new Error(`Missing R2 env: ${missing.join(', ')}`);

  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: 's3',
    region: 'auto',
  });

  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return { aws, bucket: env.R2_BUCKET_NAME!, endpoint };
}

export async function r2Put(
  env: R2Env,
  key: string,
  body: ReadableStream | ArrayBuffer | Uint8Array | Blob,
  contentType?: string,
): Promise<void> {
  const { aws, bucket, endpoint } = r2Client(env);
  const url = `${endpoint}/${bucket}/${key}`;
  const res = await aws.fetch(url, {
    method: 'PUT',
    body: body as BodyInit,
    headers: contentType ? { 'Content-Type': contentType } : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${txt}`);
  }
}

export async function r2Delete(env: R2Env, key: string): Promise<void> {
  const { aws, bucket, endpoint } = r2Client(env);
  const url = `${endpoint}/${bucket}/${key}`;
  const res = await aws.fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    throw new Error(`R2 DELETE ${key} failed: ${res.status} ${txt}`);
  }
}

export function contentTypeFor(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}
