import { z } from 'zod';

export const uuid = z.uuid({ message: 'Must be a valid UUID' });
export const idParam = z.object({ id: uuid });

export const email = z
  .email({ message: 'Must be a valid email address' })
  .max(254)
  .transform((e) => e.trim().toLowerCase());

/**
 * bcrypt only uses the first 72 bytes of its input, so longer passwords would
 * silently be truncated; we reject them instead.
 */
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number');

export const personName = z.string().trim().min(1).max(80);

/** Case-insensitive search term; empty strings are treated as "no filter". */
export const searchTerm = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((s) => (s ? s : undefined));

/** ISO date (YYYY-MM-DD) parsed to a UTC midnight Date. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');
