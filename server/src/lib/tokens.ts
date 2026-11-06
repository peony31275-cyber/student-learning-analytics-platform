import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes = 256 bits from the OS CSPRNG, as 43 base64url characters. */
const TOKEN_BYTES = 32;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Only this hash is stored. A fast SHA-256 is enough here, unlike for passwords:
 * a 256-bit random token cannot be brute-forced from its hash, and a
 * deterministic hash lets the database find the token through a unique index.
 */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function generateToken() {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, hash: hashToken(token) };
}
