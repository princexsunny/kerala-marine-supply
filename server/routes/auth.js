// Login / logout / session-status endpoints for the admin area.
const express = require('express');
const router = express.Router();
const session = require('../session');

const isProd = () => process.env.NODE_ENV === 'production';

// Throttle guessing. In-memory is the right scale here: one operator, one
// small instance. It resets on deploy, which is acceptable — the goal is to
// make online brute force impractical, not to survive restarts.
const attempts = new Map(); // ip -> { count, first, until }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

function throttleState(ip) {
  const rec = attempts.get(ip);
  if (!rec) return null;
  if (rec.until && Date.now() < rec.until) {
    return { locked: true, secondsLeft: Math.ceil((rec.until - Date.now()) / 1000) };
  }
  if (Date.now() - rec.first > WINDOW_MS) {
    attempts.delete(ip);
    return null;
  }
  return { locked: false, count: rec.count };
}

function recordFailure(ip) {
  const rec = attempts.get(ip) || { count: 0, first: Date.now(), until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.until = Date.now() + LOCKOUT_MS;
  attempts.set(ip, rec);
}

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';

  const state = throttleState(ip);
  if (state && state.locked) {
    return res.status(429).json({
      error: 'Too many failed attempts. Try again in ' + Math.ceil(state.secondsLeft / 60) + ' minute(s).',
    });
  }

  if (!session.adminPassword()) {
    return res.status(500).json({
      error: 'No admin password is configured on the server. Set ADMIN_PASSWORD.',
    });
  }

  const password = (req.body && req.body.password) || '';
  if (!session.passwordMatches(password)) {
    recordFailure(ip);
    const after = throttleState(ip);
    const left = after && !after.locked ? MAX_ATTEMPTS - after.count : 0;
    return res.status(401).json({
      error: 'Incorrect password.' + (left > 0 && left <= 3 ? ' ' + left + ' attempt(s) left.' : ''),
    });
  }

  attempts.delete(ip);
  session.issue(res, isProd());
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  session.clear(res, isProd());
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ loggedIn: session.isLoggedIn(req) });
});

module.exports = router;
