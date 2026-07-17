/** Debounce and throttle utilities for high-frequency event handling. */

export function debounce<T extends (...args: any[]) => any>(fn: T, delayMs: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  }) as T;
}

export function throttle<T extends (...args: any[]) => any>(fn: T, delayMs: number): T {
  let lastCallTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCallTime >= delayMs) {
      lastCallTime = now;
      fn(...args);
    } else {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCallTime = Date.now();
        fn(...args);
        timeoutId = null;
      }, delayMs - (now - lastCallTime));
    }
  }) as T;
}
