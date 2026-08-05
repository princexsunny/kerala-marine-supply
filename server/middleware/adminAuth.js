// HTTP Basic Auth for the admin surface (admin.html, Admin.dc.html, and the
// /api/media, /api/documents, /api/applications endpoints they call).
// Basic Auth is deliberately simple here: the browser's native credential
// prompt/cache handles the login UX for a single-operator admin page —
// no sessions, cookies, or extra dependencies required.
function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER || 'admin';
  // ADMIN_TOKEN is the name the previous version of this project used. Falling
  // back to it means an existing Render service keeps working after the
  // upgrade without re-entering the secret; ADMIN_PASSWORD overrides it.
  const pass = process.env.ADMIN_PASSWORD || process.env.ADMIN_TOKEN;

  if (!pass) {
    return res.status(500).json({
      error: 'No admin password is set on the server. Set ADMIN_PASSWORD (see .env.example).',
    });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const u = idx === -1 ? decoded : decoded.slice(0, idx);
    const p = idx === -1 ? '' : decoded.slice(idx + 1);
    if (u === user && p === pass) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Kerala Marine Supply Admin"');
  return res.status(401).json({ error: 'Authentication required.' });
}

module.exports = adminAuth;
