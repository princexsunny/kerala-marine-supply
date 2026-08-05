require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');

const adminAuth = require('./middleware/adminAuth');
const { isReady } = require('./firebase');
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

// Job applications carry a base64 resume (up to ~2MB source file, ~2.7MB
// base64) as JSON — bump the default body-size limit to fit it.
app.use(express.json({ limit: '6mb' }));

// Public API — anyone with the apply-page link can submit an application.
app.use('/api', applyRoutes);

// Public health check — used by Admin.dc.html's "server connected" dot.
app.get('/api/health', (req, res) => res.json({ ok: isReady() }));

// Admin-only API — site photos, document library, application review.
app.use('/api', adminAuth, mediaRoutes);
app.use('/api', adminAuth, documentsRoutes);
app.use('/api', adminAuth, applicationsRoutes);

// Admin pages require the same credentials as the admin API.
app.get(['/admin.html', '/Admin.dc.html'], adminAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, req.path));
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
    return res.status(400).json({ error: err.message });
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
