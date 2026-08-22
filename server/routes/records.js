// Private working records — at present, the boat yard funding sheet.
//
// WHY THIS EXISTS
// The funding page kept everything in the browser's localStorage. That is not
// storage in any sense a business should rely on:
//
//   * it lives on ONE device in ONE browser. Type it on the laptop and it is
//     not on the phone.
//   * "Clear browsing data" erases it, and people clear browsing data.
//   * Safari on iPhone and iPad deletes a site's local storage after seven
//     days without a visit. A loan record entered on a phone and left alone
//     for a week is simply gone.
//   * a lost, wiped or replaced device takes the only copy with it.
//
// The record here is the KFC loan: sanctioned amounts, what has actually been
// released, the repayment schedule and what has been paid. Losing it means
// rebuilding it from bank statements.
//
// So it is stored server-side like everything else on this site. Admin-only,
// both to read and to write — unlike media and venture links, there is no
// public half of this router, because none of it is anyone else's business.
const express = require('express');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)

// Whitelisted rather than sanitised: this names a database document, so an
// unexpected key is refused outright instead of cleaned up and written.
const KEYS = ['boat-yard-split'];

// Firestore's hard ceiling is 1 MB per document. This record is a few hundred
// rows of numbers and short text, so a limit well below that is generous and
// still refuses anything that has clearly gone wrong.
const MAX_BYTES = 400 * 1024;

router.get('/records/:key', async (req, res) => {
  const key = String(req.params.key);
  if (KEYS.indexOf(key) === -1) return res.status(400).json({ error: 'Unknown record.' });

  // Never cached. A stale copy of a funding record is worse than none.
  res.setHeader('Cache-Control', 'no-store, private');

  try {
    init();
  } catch (e) {
    return res.status(503).json({ error: 'Storage is not available right now.' });
  }

  try {
    const snap = await admin.firestore().collection('records').doc(key).get();
    if (!snap.exists) return res.json({ found: false });
    const d = snap.data() || {};
    let state = null;
    try {
      state = d.json ? JSON.parse(d.json) : null;
    } catch (e) {
      // Stored but unreadable. Say so rather than handing back a null that
      // the page would mistake for "nothing saved yet" and then overwrite.
      console.error('records: stored JSON for', key, 'will not parse');
      return res.status(500).json({ error: 'The saved record could not be read.' });
    }
    res.json({
      found: true,
      state,
      savedAt: d.savedAt && d.savedAt.toDate ? d.savedAt.toDate().toISOString() : null,
      bytes: d.bytes || 0,
    });
  } catch (err) {
    console.error('GET /api/records failed:', err);
    res.status(500).json({ error: 'Could not read the saved record.' });
  }
});

router.put('/records/:key', async (req, res) => {
  const key = String(req.params.key);
  if (KEYS.indexOf(key) === -1) return res.status(400).json({ error: 'Unknown record.' });

  const state = req.body && req.body.state;
  // A missing or non-object body must never be allowed to blank a good record.
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return res.status(400).json({ error: 'No record was sent.' });
  }

  let json;
  try {
    json = JSON.stringify(state);
  } catch (e) {
    return res.status(400).json({ error: 'That record could not be encoded.' });
  }
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_BYTES) {
    return res.status(413).json({
      error: `That record is ${Math.round(bytes / 1024)} KB, over the ${Math.round(MAX_BYTES / 1024)} KB limit.`,
    });
  }

  try {
    init();
  } catch (e) {
    return res.status(503).json({ error: 'Storage is not available right now.' });
  }

  try {
    // Stored as a JSON string rather than a nested map on purpose: Firestore
    // rejects nested arrays, and this state has arrays of arrays in the
    // repayment ladder. A string round-trips exactly, whatever shape it takes.
    await admin.firestore().collection('records').doc(key).set({
      json,
      bytes,
      savedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, bytes, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('PUT /api/records failed:', err);
    res.status(500).json({ error: 'Could not save the record.' });
  }
});

module.exports = { router, KEYS, MAX_BYTES };
