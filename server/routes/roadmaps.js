// Roadmaps — a place to think out loud and keep the thinking.
//
// A roadmap holds dated IDEAS. An idea has a note, a list of steps that can be
// ticked off with their own dates, and files attached to it. That is the whole
// shape; everything else here is keeping it honest.
//
// Admin-only in both directions. These are working notes, not published pages,
// and half of what will end up in them is commercially sensitive — supplier
// prices, what a venture is really costing, who has said yes. There is
// deliberately no public half of this router.
//
// Each roadmap is one Firestore document with its ideas inside it. That means a
// save is atomic — an idea and its steps can never be half-written — and it
// keeps the read to a single fetch. The cost is a 1 MB ceiling per roadmap,
// which the limits below stay well inside.
const express = require('express');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)

const MAX_TITLE = 120;
const MAX_SUMMARY = 600;
const MAX_NOTE = 8000;
const MAX_STEP = 400;
const MAX_IDEAS = 200;
const MAX_STEPS = 100;
const MAX_FILES = 40;
const MAX_ROADMAPS = 60;

const STATUSES = ['thinking', 'doing', 'done', 'parked'];

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max && s.length > max ? s.slice(0, max) : s;
}
// A date the app wrote, or nothing. Anything else is dropped rather than
// stored: a half-parsed date sorts wrongly for ever afterwards.
function isoDate(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function id(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function cleanStep(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('s'),
    text: str(x.text, MAX_STEP),
    done: !!x.done,
    date: isoDate(x.date),
  };
}

// Files are NOT stored here. They go through the document library like every
// other upload, and an idea keeps only the reference. One place files live.
function cleanFile(x) {
  x = x || {};
  return {
    docId: str(x.docId, 60),
    name: str(x.name, 200),
    url: str(x.url, 1500),
    size: Number(x.size) || 0,
  };
}

function cleanIdea(x) {
  x = x || {};
  const steps = (Array.isArray(x.steps) ? x.steps : []).slice(0, MAX_STEPS).map(cleanStep);
  const files = (Array.isArray(x.files) ? x.files : []).slice(0, MAX_FILES).map(cleanFile)
    .filter((f) => f.url);
  return {
    id: str(x.id, 40) || id('i'),
    title: str(x.title, MAX_TITLE),
    date: isoDate(x.date),
    status: STATUSES.indexOf(x.status) >= 0 ? x.status : 'thinking',
    note: str(x.note, MAX_NOTE),
    steps,
    files,
  };
}

function shape(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    title: d.title || 'Untitled roadmap',
    summary: d.summary || '',
    ideas: Array.isArray(d.ideas) ? d.ideas.map(cleanIdea) : [],
    createdAt: d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : null,
    updatedAt: d.updatedAt && d.updatedAt.toDate ? d.updatedAt.toDate().toISOString() : null,
  };
}

function ready(res) {
  try {
    init();
    return true;
  } catch (e) {
    res.status(503).json({ error: 'Storage is not available right now.' });
    return false;
  }
}

// ---- list ------------------------------------------------------------------

router.get('/roadmaps', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  if (!ready(res)) return;
  try {
    const snap = await admin.firestore().collection('roadmaps').get();
    const list = snap.docs.map(shape);
    // Newest first, and anything without a date last rather than dropped.
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(list);
  } catch (err) {
    console.error('GET /api/roadmaps failed:', err);
    res.status(500).json({ error: 'Could not load the roadmaps.' });
  }
});

router.get('/roadmaps/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, private');
  if (!ready(res)) return;
  try {
    const doc = await admin.firestore().collection('roadmaps').doc(String(req.params.id)).get();
    if (!doc.exists) return res.status(404).json({ error: 'That roadmap is no longer here.' });
    res.json(shape(doc));
  } catch (err) {
    console.error('GET /api/roadmaps/:id failed:', err);
    res.status(500).json({ error: 'Could not load that roadmap.' });
  }
});

// ---- create ----------------------------------------------------------------

router.post('/roadmaps', async (req, res) => {
  if (!ready(res)) return;
  const title = str((req.body || {}).title, MAX_TITLE);
  if (!title) return res.status(400).json({ error: 'Give the roadmap a name.' });

  try {
    const db = admin.firestore();
    const existing = await db.collection('roadmaps').get();
    if (existing.size >= MAX_ROADMAPS) {
      return res.status(400).json({ error: `That is ${MAX_ROADMAPS} roadmaps, the maximum. Delete one first.` });
    }
    const ref = await db.collection('roadmaps').add({
      title,
      summary: str((req.body || {}).summary, MAX_SUMMARY),
      ideas: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const doc = await ref.get();
    res.json(shape(doc));
  } catch (err) {
    console.error('POST /api/roadmaps failed:', err);
    res.status(500).json({ error: 'Could not create the roadmap.' });
  }
});

// ---- save ------------------------------------------------------------------
//
// One PUT for the whole roadmap rather than a route per idea and per step.
// The page holds the roadmap it is editing, so sending it back whole is both
// simpler and atomic: there is no way to end up with a step saved against an
// idea that failed to save.

router.put('/roadmaps/:id', async (req, res) => {
  if (!ready(res)) return;
  const body = req.body || {};
  const title = str(body.title, MAX_TITLE);
  if (!title) return res.status(400).json({ error: 'A roadmap needs a name.' });

  const rawIdeas = Array.isArray(body.ideas) ? body.ideas : [];
  if (rawIdeas.length > MAX_IDEAS) {
    return res.status(400).json({ error: `That is more than ${MAX_IDEAS} ideas in one roadmap.` });
  }

  // A note that is too long is REFUSED, not quietly shortened. Everything here
  // saves as you type, so trimming the end off a note would lose work without
  // anybody noticing until they came back for it. Being told at once is worse
  // for a second and better for ever after.
  for (let i = 0; i < rawIdeas.length; i++) {
    const n = String((rawIdeas[i] || {}).note || '');
    if (n.length > MAX_NOTE) {
      const who = str((rawIdeas[i] || {}).title, 60) || `idea ${i + 1}`;
      return res.status(400).json({
        error: `The note on "${who}" is ${n.length} characters, over the ${MAX_NOTE} limit. `
             + 'Shorten it, or attach it as a file instead.',
      });
    }
  }

  const ideas = rawIdeas.map(cleanIdea);

  const payload = { title, summary: str(body.summary, MAX_SUMMARY), ideas };
  // Firestore's limit is 1 MB per document. Refuse early, with the size named,
  // rather than letting the write fail with something unreadable.
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > 800 * 1024) {
    return res.status(413).json({
      error: `That roadmap is ${Math.round(bytes / 1024)} KB, too big to store. Shorten some notes.`,
    });
  }

  try {
    const ref = admin.firestore().collection('roadmaps').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'That roadmap is no longer here.' });
    await ref.update({ ...payload, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    const doc = await ref.get();
    res.json(shape(doc));
  } catch (err) {
    console.error('PUT /api/roadmaps failed:', err);
    res.status(500).json({ error: 'Could not save the roadmap.' });
  }
});

// ---- delete ----------------------------------------------------------------

router.delete('/roadmaps/:id', async (req, res) => {
  if (!ready(res)) return;
  try {
    const ref = admin.firestore().collection('roadmaps').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'That roadmap is no longer here.' });
    // The attached FILES are deliberately left alone. They live in the document
    // library and may well be referenced elsewhere; deleting a roadmap should
    // not quietly take a sanction letter with it.
    await ref.delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/roadmaps failed:', err);
    res.status(500).json({ error: 'Could not delete the roadmap.' });
  }
});

module.exports = { router, STATUSES, MAX_IDEAS, MAX_ROADMAPS };
