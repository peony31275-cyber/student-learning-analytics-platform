import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type Pagination = z.infer<typeof paginationQuery>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/** Offset pagination arguments for Prisma. */
export const toSkipTake = ({ page, pageSize }: Pagination) => ({ skip: (page - 1) * pageSize, take: pageSize });

export function buildPage<T>(items: T[], total: number, { page, pageSize }: Pagination): Paginated<T> {
  return { items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}
