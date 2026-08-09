// Editable website / link for each venture.
//
// ventures-data.js ships a sensible default for the ventures that already have
// a site. This lets those be changed, and the other ten given a link, from
// /admin.html without editing code — stored in Firestore collection
// "ventureLinks", doc id = the venture's slug.
//
// Split into two routers for the same reason as media: the READ is public (the
// venture pages call it for every visitor) while writing stays admin-only.
const express = require('express');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)
const publicRouter = express.Router();

// The twelve slugs, mirroring public/ventures-data.js. Whitelisted rather than
// sanitised: this writes to the database, so an unexpected key is refused
// outright instead of being cleaned up and stored.
const SLUGS = [
  'fishing-net-online', 'marine-machine-manufacturing', 'fisherman-finance',
  'boat-yard', 'marine-fuels', 'shipbuilding', 'fishing-gear', 'fish-online',
  'marine-engineering', 'marine-spare-parts', 'cold-chain', 'seafood-export',
];

const MAX_LABEL = 60;
const MAX_HREF = 500;

// Only http(s) and same-site relative paths are allowed. This matters: these
// URLs are rendered as links on a public page, so accepting anything else
// would let a "javascript:" or "data:" URL be stored and then run in a
// visitor's browser.
function cleanHref(raw) {
  const href = String(raw == null ? '' : raw).trim();
  if (!href) return '';
  if (href.length > MAX_HREF) return null;

  // A relative page on this site, e.g. "ledger-app.html".
  if (/^[A-Za-z0-9._~\-/]+(\?[^\s"'<>]*)?$/.test(href) && !href.includes(':')) {
    return href;
  }
  try {
    const u = new URL(href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) { /* not a URL */ }
  return null;   // null means "rejected", '' means "cleared"
}

// ---- Public read -----------------------------------------------------------

publicRouter.get('/venture-links', async (req, res) => {
  // Never cache: an edited link should show on the next page load, and an
  // empty response from a momentary outage must not stick.
  res.setHeader('Cache-Control', 'no-cache');

  try {
    init();
  } catch (e) {
    console.error('GET /api/venture-links: Firebase not ready:', e.message);
    return res.json({});
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('ventureLinks').get();
    const out = {};
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      if (!data.href) return;
      out[d.id] = { href: data.href, label: data.label || 'Visit website' };
    });
    res.json(out);
  } catch (err) {
    console.error('GET /api/venture-links failed:', err);
    res.json({});   // fail soft: the page falls back to its built-in link
  }
});

// ---- Admin write -----------------------------------------------------------

// PUT /api/venture-links — body { slug: { href, label } }.
// An empty href clears that venture's link and restores the built-in default.
router.put('/venture-links', async (req, res) => {
  const body = req.body || {};
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ error: 'Nothing was sent.' });

  const bad = keys.filter((k) => SLUGS.indexOf(k) === -1);
  if (bad.length) return res.status(400).json({ error: 'Unknown venture: ' + bad[0] });

  // Validate everything BEFORE writing anything, so a single bad URL can't
  // leave half the ventures updated and half not.
  const writes = [];
  for (const slug of keys) {
    const entry = body[slug] || {};
    const href = cleanHref(entry.href);
    if (href === null) {
      return res.status(400).json({
        error: 'That web address is not valid for ' + slug +
               '. Use a full address starting with https://',
      });
    }
    const label = String(entry.label == null ? '' : entry.label).trim().slice(0, MAX_LABEL);
    writes.push({ slug, href, label: label || 'Visit website' });
  }

  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const batch = db.batch();
    writes.forEach((w) => {
      const ref = db.collection('ventureLinks').doc(w.slug);
      if (!w.href) batch.delete(ref);          // cleared
      else batch.set(ref, {
        href: w.href,
        label: w.label,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    res.json({ ok: true, saved: writes.length });
  } catch (err) {
    console.error('PUT /api/venture-links failed:', err);
    res.status(500).json({ error: 'Could not save the links. Please try again.' });
  }
});

module.exports = { router, publicRouter, SLUGS };
