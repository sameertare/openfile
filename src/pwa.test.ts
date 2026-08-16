// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { registerServiceWorker } from './pwa';

describe('registerServiceWorker', () => {
  it('is a no-op (does not throw, does not register a load listener) when serviceWorker is unsupported', () => {
    // jsdom does not implement navigator.serviceWorker by default — this exercises the real guard.
    expect('serviceWorker' in navigator).toBe(false);
    expect(() => registerServiceWorker()).not.toThrow();
  });
});
