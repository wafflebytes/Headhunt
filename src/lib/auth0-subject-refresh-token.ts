import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

import { db } from '@/lib/db';
import { auth0SubjectRefreshTokens } from '@/lib/db/schema/auth0-subject-refresh-tokens';

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const SUBJECT_TOKEN_ENCRYPTED_PREFIX = 'enc:';
const SUBJECT_TOKEN_PLAINTEXT_PREFIX = 'plain:';

function getEncryptionKey(): string | null {
  return asString(process.env.AUTH0_SUBJECT_TOKEN_ENCRYPTION_KEY) ?? null;
}

function toBase64(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString('base64');
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function encrypt(plaintext: string, key: string): Promise<string> {
  const iv = crypto.randomBytes(12);
  const keyMaterial = crypto.createHash('sha256').update(key).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${toBase64(iv)}.${toBase64(tag)}.${toBase64(encrypted)}`;
}

async function decrypt(payload: string, key: string): Promise<string> {
  const [ivBase64, tagBase64, dataBase64] = payload.split('.');
  if (!ivBase64 || !tagBase64 || !dataBase64) {
    throw new Error('Invalid encrypted refresh token format.');
  }

  const iv = fromBase64(ivBase64);
  const tag = fromBase64(tagBase64);
  const data = fromBase64(dataBase64);
  const keyMaterial = crypto.createHash('sha256').update(key).digest();

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial, iv);
  decipher.setAuthTag(Buffer.from(tag));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(data)), decipher.final()]);
  return decrypted.toString('utf8');
}

async function encodeRefreshToken(rawToken: string): Promise<string> {
  const key = getEncryptionKey();
  if (!key) {
    return `${SUBJECT_TOKEN_PLAINTEXT_PREFIX}${rawToken}`;
  }

  const encrypted = await encrypt(rawToken, key);
  return `${SUBJECT_TOKEN_ENCRYPTED_PREFIX}${encrypted}`;
}

async function decodeRefreshToken(storedValue: string): Promise<string> {
  const normalized = storedValue.trim();

  if (normalized.startsWith(SUBJECT_TOKEN_PLAINTEXT_PREFIX)) {
    return normalized.slice(SUBJECT_TOKEN_PLAINTEXT_PREFIX.length);
  }

  if (normalized.startsWith(SUBJECT_TOKEN_ENCRYPTED_PREFIX)) {
    const key = getEncryptionKey();
    if (!key) {
      throw new Error('AUTH0_SUBJECT_TOKEN_ENCRYPTION_KEY is required to decrypt stored refresh tokens.');
    }

    return decrypt(normalized.slice(SUBJECT_TOKEN_ENCRYPTED_PREFIX.length), key);
  }

  // Backwards compat / manual entry: attempt decrypt when it looks like the raw payload.
  if (normalized.includes('.')) {
    const key = getEncryptionKey();
    if (key) {
      try {
        return await decrypt(normalized, key);
      } catch {
        return normalized;
      }
    }
  }

  return normalized;
}

export async function upsertAuth0SubjectRefreshToken(params: { userId: string; refreshToken: string }) {
  const userId = asString(params.userId);
  const refreshToken = asString(params.refreshToken);
  if (!userId || !refreshToken) {
    return;
  }

  const storedValue = await encodeRefreshToken(refreshToken);

  await db
    .insert(auth0SubjectRefreshTokens)
    .values({
      userId,
      refreshToken: storedValue,
    })
    .onConflictDoUpdate({
      target: auth0SubjectRefreshTokens.userId,
      set: {
        refreshToken: storedValue,
        updatedAt: new Date(),
      },
    });
}

export async function getAuth0SubjectRefreshToken(userId: string): Promise<string | null> {
  const normalizedUserId = asString(userId);
  if (!normalizedUserId) {
    return null;
  }

  const [row] = await db
    .select({ refreshToken: auth0SubjectRefreshTokens.refreshToken })
    .from(auth0SubjectRefreshTokens)
    .where(eq(auth0SubjectRefreshTokens.userId, normalizedUserId))
    .limit(1);

  const stored = asString(row?.refreshToken);
  if (!stored) {
    return null;
  }

  return decodeRefreshToken(stored);
}
