// Signed-cookie sessions for the admin area.
//
// Deliberately dependency-free: an HMAC over {expiry} is all a single-operator
// admin login needs. There is no session store — the cookie IS the session,
// and its signature is what makes it unforgeable. Changing the admin password
// (or SESSION_SECRET) changes the signing key, which invalidates every
// existing cookie — a free "log out everywhere" on password change.
const crypto = require('crypto');

const COOKIE_NAME = 'kms_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

function adminPassword() {
  // ADMIN_TOKEN is the older name, still set on the live Render service.
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN || '';
}

function secret() {
  // An explicit SESSION_SECRET is preferred; deriving from the password keeps
  // things working with zero extra configuration, at the cost of logging
  // everyone out when the password changes (which is the desired behaviour).
  return process.env.SESSION_SECRET || 'kms:' + adminPassword();
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;

  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}

// Compare without leaking how much of the password matched via timing.
function passwordMatches(attempt) {
  const real = adminPassword();
  if (!real) return false;
  const a = Buffer.from(String(attempt));
  const b = Buffer.from(real);
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong-length guess isn't measurably faster.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function issue(res, isProd) {
  const token = sign({ exp: Date.now() + MAX_AGE_MS });
  const bits = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',                       // unreadable from JavaScript, so XSS can't steal it
    'SameSite=Lax',                   // blocks cross-site form-post CSRF
    'Max-Age=' + Math.floor(MAX_AGE_MS / 1000),
  ];
  // Secure would make the cookie undeliverable over plain http on localhost.
  if (isProd) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function clear(res, isProd) {
  const bits = [COOKIE_NAME + '=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) bits.push('Secure');
  res.setHeader('Set-Cookie', bits.join('; '));
}

function isLoggedIn(req) {
  return !!verify(parseCookies(req)[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  adminPassword,
  passwordMatches,
  parseCookies,
  issue,
  clear,
  isLoggedIn,
};
