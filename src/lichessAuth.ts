/** Lichess OAuth 2.0 Authorization Code flow with PKCE — hand-rolled per lichess.org/api's own
 *  documented flow (no client secret; Lichess explicitly supports "unregistered public clients,
 *  choose any unique client id"). Used only to obtain a Bearer token for the authenticated-only
 *  Opening Explorer book-theory endpoint (explorer.lichess.org now returns 401 without one) — no
 *  other permission is requested, so scope is left empty.
 *
 *  Access tokens are long-lived (~1 year per Lichess's docs) and there's no refresh-token support,
 *  so the token is just cached in localStorage until the user disconnects or it's rejected. */

const CLIENT_ID = 'openfile-chess-insight';
const VERIFIER_KEY = 'openfile-lichess-pkce';
const AUTH_KEY = 'openfile-lichess-auth';

export interface LichessAuth {
  token: string;
  username: string;
}

function redirectUri(): string {
  return `${location.origin}${location.pathname}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

export function getStoredAuth(): LichessAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredAuth(auth: LichessAuth) {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  } catch {
    // localStorage unavailable — the connection just won't persist across reloads
  }
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
}

/** Kicks off the login redirect — generates a fresh PKCE verifier/state pair, stashes it for the
 *  return trip, then navigates away to Lichess's consent screen. Never resolves (the page
 *  navigates before the promise would settle). */
export async function startLogin(): Promise<void> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(verifierBytes);
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = base64UrlEncode(await sha256(verifier));

  sessionStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, state }));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: '',
  });
  window.location.href = `https://lichess.org/oauth?${params.toString()}`;
}

export function isReturningFromAuthServer(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has('code') || p.has('error');
}

/** Completes the flow if the page was just redirected back from Lichess with `?code=...` — reads
 *  the stashed verifier/state, exchanges the code for a token, fetches the username, persists both,
 *  and strips the OAuth params from the URL (preserving any other query params already there)
 *  regardless of outcome, so a reload never re-attempts a spent, single-use code.
 *  Returns null if the page wasn't returning from the auth server, the flow failed, or the user
 *  declined consent (`?error=...`). */
export async function completeLogin(): Promise<LichessAuth | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const hadOAuthParams = params.has('code') || params.has('error') || params.has('state');

  const cleanup = () => {
    if (!hadOAuthParams) return;
    params.delete('code');
    params.delete('state');
    params.delete('error');
    params.delete('error_description');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
  };

  if (!code) {
    cleanup();
    return null;
  }

  const stashRaw = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!stashRaw) { cleanup(); return null; }
  const { verifier, state } = JSON.parse(stashRaw) as { verifier: string; state: string };
  if (returnedState !== state) { cleanup(); return null; } // possible CSRF — refuse to proceed

  try {
    const tokenResp = await fetch('https://lichess.org/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
      }),
    });
    if (!tokenResp.ok) { cleanup(); return null; }
    const tokenData = await tokenResp.json();
    const token = tokenData.access_token as string;
    if (!token) { cleanup(); return null; }

    const accountResp = await fetch('https://lichess.org/api/account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!accountResp.ok) { cleanup(); return null; }
    const account = await accountResp.json();
    const auth: LichessAuth = { token, username: account.username };
    setStoredAuth(auth);
    cleanup();
    return auth;
  } catch {
    cleanup();
    return null;
  }
}

/** Best-effort server-side token revocation, then always clears the local copy. */
export async function logout(): Promise<void> {
  const auth = getStoredAuth();
  if (auth) {
    try {
      await fetch('https://lichess.org/api/token', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    } catch {
      // ignore — clearing the local copy still logs the user out of this app
    }
  }
  clearStoredAuth();
}
