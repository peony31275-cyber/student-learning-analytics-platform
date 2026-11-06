import bcrypt from 'bcrypt';
import { env } from '../config/env.js';

export const hashPassword = (plain: string) => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

let dummyHash: Promise<string> | undefined;

/**
 * Runs a bcrypt comparison against a throwaway hash when the email does not
 * exist, so a failed login takes the same time whether or not the account
 * exists. This prevents user enumeration through response timing.
 */
export async function burnPasswordCheck(plain: string): Promise<false> {
  dummyHash ??= bcrypt.hash('timing-equalizer', env.BCRYPT_ROUNDS);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}
