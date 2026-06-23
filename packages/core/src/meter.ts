/**
 * Count the Discord API calls a build makes, for cost analytics. A Proxy increments a counter on
 * every method invocation before delegating — wrap the port with this (under the resilient wrapper)
 * and read `count()` after the build for the per-build API-call total.
 */
export interface Meter<T> {
  port: T;
  count: () => number;
}

export function meterPort<T extends object>(port: T): Meter<T> {
  let calls = 0;
  const wrapped = new Proxy(port, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      return (...args: unknown[]) => {
        calls += 1;
        return (orig as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as T;
  return { port: wrapped, count: () => calls };
}
