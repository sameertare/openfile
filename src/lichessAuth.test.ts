// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStoredAuth, clearStoredAuth, isReturningFromAuthServer, completeLogin } from './lichessAuth';

const AUTH_KEY = 'openfile-lichess-auth';
const VERIFIER_KEY = 'openfile-lichess-pkce';

function goTo(url: string) {
  window.history.pushState({}, '', url);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  goTo('/analyze.html');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getStoredAuth / clearStoredAuth', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredAuth()).toBeNull();
  });

  it('round-trips a stored auth object', () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'abc', username: 'Hero' }));
    expect(getStoredAuth()).toEqual({ token: 'abc', username: 'Hero' });
  });

  it('returns null instead of throwing on corrupted stored JSON', () => {
    localStorage.setItem(AUTH_KEY, '{not valid json');
    expect(getStoredAuth()).toBeNull();
  });

  it('clearStoredAuth removes the stored auth', () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: 'abc', username: 'Hero' }));
    clearStoredAuth();
    expect(getStoredAuth()).toBeNull();
  });
});

describe('isReturningFromAuthServer', () => {
  it('is true when the URL has a "code" param', () => {
    goTo('/analyze.html?code=xyz');
    expect(isReturningFromAuthServer()).toBe(true);
  });
  it('is true when the URL has an "error" param', () => {
    goTo('/analyze.html?error=access_denied');
    expect(isReturningFromAuthServer()).toBe(true);
  });
  it('is false for an ordinary URL', () => {
    goTo('/analyze.html');
    expect(isReturningFromAuthServer()).toBe(false);
  });
});

describe('completeLogin', () => {
  it('returns null and leaves the URL alone when not returning from the auth server', async () => {
    goTo('/analyze.html');
    const result = await completeLogin();
    expect(result).toBeNull();
    expect(location.search).toBe('');
  });

  it('returns null and strips OAuth params when there is no matching PKCE stash', async () => {
    goTo('/analyze.html?code=abc123&state=s1');
    const result = await completeLogin();
    expect(result).toBeNull();
    expect(location.search).not.toContain('code=');
  });

  it('returns null on a state mismatch (possible CSRF) without exchanging the code', async () => {
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier: 'v1', state: 'expected-state' }));
    goTo('/analyze.html?code=abc123&state=wrong-state');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await completeLogin();
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('consumes the PKCE stash even on failure, so a reload does not re-attempt it', async () => {
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier: 'v1', state: 'expected-state' }));
    goTo('/analyze.html?code=abc123&state=wrong-state');
    await completeLogin();
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
  });

  it('exchanges the code, fetches the account, persists auth, and cleans the URL on success', async () => {
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier: 'v1', state: 'good-state' }));
    goTo('/analyze.html?code=abc123&state=good-state&other=keep-me');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok123' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ username: 'Hero' }) }));

    const result = await completeLogin();
    expect(result).toEqual({ token: 'tok123', username: 'Hero' });
    expect(getStoredAuth()).toEqual({ token: 'tok123', username: 'Hero' });
    expect(location.search).not.toContain('code=');
    expect(location.search).toContain('other=keep-me'); // non-OAuth params are preserved
  });

  it('returns null and cleans up when the token exchange itself fails', async () => {
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier: 'v1', state: 'good-state' }));
    goTo('/analyze.html?code=abc123&state=good-state');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await completeLogin();
    expect(result).toBeNull();
    expect(getStoredAuth()).toBeNull();
  });

  it('returns null instead of throwing when fetch itself rejects (offline)', async () => {
    sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier: 'v1', state: 'good-state' }));
    goTo('/analyze.html?code=abc123&state=good-state');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(completeLogin()).resolves.toBeNull();
  });
});
