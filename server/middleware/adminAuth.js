// Gate for the admin area. Replaces the old HTTP Basic Auth, which showed the
// browser's native credential popup and had no way to log out.
//
// Two different failure responses, because two different callers:
//   - a page request  -> redirect to the login page (a human is looking)
//   - an /api/ request -> 401 JSON (fetch() is looking; the page then redirects)
const session = require('./../session');

function adminAuth(req, res, next) {
  if (!session.adminPassword()) {
    return res.status(500).json({
      error: 'No admin password is set on the server. Set ADMIN_PASSWORD (see .env.example).',
    });
  }

  if (session.isLoggedIn(req)) return next();

  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not signed in.' });
  }

  // Remember where they were headed so login can send them back.
  const target = encodeURIComponent(req.originalUrl || '/admin.html');
  return res.redirect(302, '/login.html?next=' + target);
}

module.exports = adminAuth;
