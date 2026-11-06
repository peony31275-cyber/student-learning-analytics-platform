import type { Prisma } from '../generated/prisma/client.js';

/** Prisma returns NUMERIC columns as Decimal; the API exposes plain numbers. */
export const toNumber = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d === null || d === undefined ? null : Number(d);

export const round = (n: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
