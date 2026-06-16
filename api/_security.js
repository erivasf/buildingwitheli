// Shared security utilities for serverless functions.
// Files prefixed with `_` are not deployed as routes by Vercel.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const MAX_LENGTHS = {
  brand: 200,
  url: 500,
  industry: 200,
  geografia: 200,
  comp1: 200,
  comp2: 200,
  comp3: 200,
  objetivo: 2000,
  email: 254, // RFC 5321 max for the full email address
  source: 100,
  idioma: 50,
};

export function isValidUrl(s) {
  if (!s || typeof s !== 'string') return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidEmail(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length > MAX_LENGTHS.email) return false;
  return EMAIL_RE.test(s);
}

export function maskEmail(e) {
  if (!e || typeof e !== 'string') return '?';
  const at = e.indexOf('@');
  if (at < 0) return '?';
  const user = e.slice(0, at);
  const domain = e.slice(at + 1);
  const head = user.length <= 2 ? user[0] || '?' : user.slice(0, 2);
  return `${head}***@${domain}`;
}

export function checkLengths(body) {
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const v = body[field];
    if (v != null && String(v).length > max) {
      return `${field} excede ${max} caracteres.`;
    }
  }
  return null;
}

// Wrap raw user input with explicit data-not-instructions delimiters.
// Also escapes any attempt to inject a closing tag.
export function wrapUserInput(val) {
  if (val == null) return '<user_input></user_input>';
  const safe = String(val).replace(/<\/user_input>/gi, '< /user_input >');
  return `<user_input>${safe}</user_input>`;
}

// fetch with timeout + 1 retry on 429/503/network errors.
// Use for non-SDK endpoints (Airtable, Beehiiv) — Anthropic/Resend SDKs handle their own retries.
export async function fetchWithRetry(url, options = {}, { timeoutMs = 10000, maxRetries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: ac.signal });
      clearTimeout(timer);
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError;
}
