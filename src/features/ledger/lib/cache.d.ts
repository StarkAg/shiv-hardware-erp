import type { FunctionReference, FunctionReturnType } from 'convex/server'

/**
 * `useQuery`, answering with the last result seen on this device while the
 * live one loads (see cache.js). Typed like `useQuery` so TypeScript callers
 * keep the query's own return type.
 */
export function useLive<Query extends FunctionReference<'query'>>(
  fnRef: Query,
  args: Query['_args'] | 'skip',
  key: string,
): FunctionReturnType<Query> | undefined
