require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');

const adminAuth = require('./middleware/adminAuth');
const session = require('./session');
const { isReady } = require('./firebase');
const authRoutes = require('./routes/auth');
const applyRoutes = require('./routes/apply');
const mediaRoutes = require('./routes/media');
const documentsRoutes = require('./routes/documents');
const applicationsRoutes = require('./routes/applications');

const app = express();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProd = process.env.NODE_ENV === 'production';

// Render terminates TLS at its load balancer and forwards over HTTP, so
// without this req.protocol is always "http" and req.ip is the proxy's
// address. One hop — Render's LB — hence 1 rather than `true`.
app.set('trust proxy', 1);

// Deliberately NOT redirecting http->https or www->apex here: Render already
// does both for custom domains (it auto-creates the www record and redirects
// it to the root). Doing it again in the app is how you get redirect loops.

// Security headers. Kept hand-rolled rather than pulling in helmet — this is
// the full set that actually applies to a static site plus a small JSON API,
// and it avoids a dependency whose defaults would need overriding anyway.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Opt out of Chrome's ad-tech APIs; nothing here uses them.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
  if (isProd) {
    // Only in production: sending HSTS from localhost would pin your browser
    // to https://localhost and make local development unreachable.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// JSON bodies carry base64-encoded files: a resume (2MB cap) or a batch of
// site photos. Base64 inflates by ~37%, so the limit must exceed the largest
// expected file by a wide margin — an 8MB photo arrives as ~11MB of JSON.
// The admin page also downscales images before sending, so real requests are
// far smaller than this ceiling; it exists so an unresized upload fails with
// a clear message instead of at the parser.
app.use(express.json({ limit: '25mb' }));

// Login / logout / session status. Public by necessity — this is how you get
// a session in the first place; /api/login does its own rate limiting.
app.use('/api', authRoutes);

// Public API — anyone with the apply-page link can submit an application.
app.use('/api', applyRoutes);

// Public health check — used by Admin.dc.html's "server connected" dot.
app.get('/api/health', (req, res) => res.json({ ok: isReady() }));

// Admin-only API — site photos, document library, application review.
app.use('/api', adminAuth, mediaRoutes);
app.use('/api', adminAuth, documentsRoutes);
app.use('/api', adminAuth, applicationsRoutes);

// Admin pages sit behind the same session as the admin API.
app.get(['/admin.html', '/Admin.dc.html'], adminAuth, (req, res) => {
  // Never let a proxy or the browser cache a signed-in admin page — a later
  // signed-out visitor on the same machine could otherwise be served it.
  res.setHeader('Cache-Control', 'no-store, private');
  res.sendFile(path.join(PUBLIC_DIR, req.path));
});

// Already signed in? Skip the login form.
app.get('/login.html', (req, res, next) => {
  if (session.isLoggedIn(req)) return res.redirect(302, '/admin.html');
  res.setHeader('Cache-Control', 'no-store, private');
  next();
});

// Everything else (index.html, careers.html, apply.html, design-system
// assets, images) is served as plain static files.
app.use(
  express.static(PUBLIC_DIR, {
    // HTML must revalidate so content edits go live on the next visit;
    // fingerprint-free assets (_ds/, image-slot.js) get a short cache.
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  })
);

// Unknown paths: send the site's own 404 rather than Express's stack-trace
// page. JSON for API paths so a bad fetch doesn't get an HTML body.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
    if (err) res.status(404).type('txt').send('Not found');
  });
});

// Multer (file-too-large, etc.) and any other error lands here as JSON
// instead of Express's default HTML error page.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'That file is too large (200 MB maximum).' });
    }
    return res.status(400).json({ error: err.message });
  }
  // Body-parser rejects oversized JSON before any route runs. Reporting it as
  // a 500 (the old behaviour) made an ordinary "photo too big" look like a
  // server crash — say what actually happened and how much was sent.
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
    console.warn('Rejected oversized body:', err.length, 'bytes (limit', err.limit + ')');
    return res.status(413).json({
      error:
        'That upload is too large' +
        (err.length ? ' (' + mb(err.length) + ' after encoding, limit ' + mb(err.limit) + ')' : '') +
        '. Try a smaller image, or upload one photo at a time.',
    });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kerala Marine Supply server listening on port ${PORT}`);
  if (!isReady()) {
    console.warn('Firebase is not configured yet — API routes will return 500 until .env is filled in (see .env.example).');
  }
});
