import type { Request } from 'express';
import { type AugmentedRequest, rateLimit } from 'express-rate-limit';

export interface CredentialRateLimit {
  /** Failed attempts allowed per client IP within the window. */
  limit: number;
  windowMs: number;
}

/**
 * Brute-force protection for one credential endpoint (login, registration or
 * password change). Create one per endpoint, so each has its own budget.
 *
 * - Keyed by client IP (the library default; IPv6 is grouped per /56 subnet).
 *   In production `trust proxy` makes req.ip the real client address.
 * - Only failed attempts count (`skipSuccessfulRequests`): a correct sign-in,
 *   e.g. switching between accounts, never uses up the budget. A success does
 *   not reset earlier failures either; otherwise anyone with one valid account
 *   could keep guessing other passwords from the same IP.
 * - Fixed window: the count resets `windowMs` after the window's first attempt.
 *   Blocked requests do not extend the block.
 */
export function credentialLimiter({ limit, windowMs }: CredentialRateLimit) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: true,
    // RateLimit-Policy and RateLimit on every response, Retry-After when blocked.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: (req: Request) => ({
      error: {
        code: 'RATE_LIMITED',
        message: `Too many failed attempts. Try again in ${waitTime(req, windowMs)}.`,
      },
    }),
  });
}

function waitTime(req: Request, windowMs: number) {
  const resetAt =
    (req as AugmentedRequest).rateLimit?.resetTime?.getTime() ?? Date.now() + windowMs;
  const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
