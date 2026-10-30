import type { ReactNode } from "react";
import { useOnline } from "../data/hooks.js";

/**
 * A server read in place on a screen (design D8): its content once loaded
 * (kept, offline too, once it has been), else what offline looks like, else
 * the failure with a way to try again, else its skeleton. The one order
 * every screen's server read follows.
 */
export function ServerRead<T>({
  query,
  offline,
  error,
  skeleton,
  children,
}: {
  query: { data: T | undefined; error: Error | null; refetch: () => unknown };
  /** In place of the content with no signal and nothing loaded. */
  offline: ReactNode;
  /** A failed read; `retry` reads again. */
  error: (error: Error, retry: () => void) => ReactNode;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const online = useOnline();
  if (query.data !== undefined) return children(query.data);
  if (!online) return offline;
  if (query.error) return error(query.error, () => void query.refetch());
  return skeleton;
}
