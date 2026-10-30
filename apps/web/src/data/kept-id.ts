import { newId } from "@workout-tracker/shared";

/**
 * Runs a plan-side write with a client-minted id kept until the write
 * succeeds (apps/web/CLAUDE.md, "ids kept until success"). `call` gets the
 * id kept under `key`, minted the first time. Success forgets it, so the
 * next call is another write; a failure keeps it, so tapping again after a
 * lost answer repeats the same request and the server writes once.
 *
 * With `mint`, what is kept can be anything a retry must repeat exactly (the
 * builder keeps a whole save request); `forgetOn` drops it after a failure
 * that will never succeed as sent.
 */
export function withKeptId<K, R>(
  kept: Map<K, string>,
  key: K,
  call: (id: string) => Promise<R>,
): Promise<R>;
export function withKeptId<K, V, R>(
  kept: Map<K, V>,
  key: K,
  call: (value: V) => Promise<R>,
  options: { mint: () => V; forgetOn?: (error: unknown) => boolean },
): Promise<R>;
export async function withKeptId<K, V, R>(
  kept: Map<K, V>,
  key: K,
  call: (value: V) => Promise<R>,
  options?: { mint: () => V; forgetOn?: (error: unknown) => boolean },
): Promise<R> {
  const value = kept.has(key)
    ? (kept.get(key) as V)
    : // Only the first overload omits `options`, and its values are ids.
      options
      ? options.mint()
      : (newId() as V);
  kept.set(key, value);
  const forget = () => {
    if (kept.get(key) === value) kept.delete(key);
  };
  try {
    const result = await call(value);
    forget();
    return result;
  } catch (error) {
    if (options?.forgetOn?.(error)) forget();
    throw error;
  }
}
