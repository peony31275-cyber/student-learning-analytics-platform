import { type ReactNode, Suspense } from 'react';
import { Loading } from './ui';

export const withSuspense = (node: ReactNode) => (
  <Suspense fallback={<Loading height={240} />}>{node}</Suspense>
);
