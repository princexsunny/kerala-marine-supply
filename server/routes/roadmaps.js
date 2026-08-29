// Roadmaps — a place to think out loud and keep the thinking.
//
// A roadmap is a numbered list of STEPS, each of which can hold SUB STEPS.
// Every step and sub step carries where it has got to, the date it is expected,
// and any files attached to it. That is the whole shape; everything else here
// is keeping it honest.
//
// Admin-only in both directions. These are working notes, not published pages,
// and half of what will end up in them is commercially sensitive — supplier
// prices, what a venture is really costing, who has said yes. There is
// deliberately no public half of this router.
//
// Each roadmap is one Firestore document with its steps inside it. That means a
// save is atomic — a step and its sub steps can never be half-written — and it
// keeps the read to a single fetch. The cost is a 1 MB ceiling per roadmap,
// which the limits below stay well inside.
const express = require('express');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)

const MAX_TITLE = 120;
const MAX_SUMMARY = 600;
const MAX_NOTE = 8000;
const MAX_STEPS = 200;
const MAX_SUBS = 100;
const MAX_FILES = 40;
const MAX_ROADMAPS = 60;

// Where a step has got to. "expecting" is not a synonym for pending: it means
// a date has been given by whoever you are waiting on, which is a different
// thing to have on a roadmap than something nobody has started.
const STATUSES = ['not-started', 'pending', 'in-progress', 'expecting', 'done'];

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
function status(v) {
  return STATUSES.indexOf(v) >= 0 ? v : 'not-started';
}

// Files are NOT stored here. They go through the document library like every
// other upload, and a step keeps only the reference. One place files live.
function cleanFile(x) {
  x = x || {};
  return {
    docId: str(x.docId, 60),
    name: str(x.name, 200),
    url: str(x.url, 1500),
    size: Number(x.size) || 0,
  };
}
function cleanFiles(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, MAX_FILES).map(cleanFile).filter((f) => f.url);
}

function cleanSub(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('b'),
    title: str(x.title, MAX_TITLE),
    status: status(x.status),
    date: isoDate(x.date),
    files: cleanFiles(x.files),
  };
}

function cleanStep(x) {
  x = x || {};
  return {
    id: str(x.id, 40) || id('t'),
    title: str(x.title, MAX_TITLE),
    status: status(x.status),
    date: isoDate(x.date),
    note: str(x.note, MAX_NOTE),
    files: cleanFiles(x.files),
    subs: (Array.isArray(x.subs) ? x.subs : []).slice(0, MAX_SUBS).map(cleanSub),
    open: !!x.open,
  };
}

// Roadmaps saved under the first shape had "ideas", each with its own note and
// a list of tick-box steps. Those map cleanly onto the shape here — an idea is
// a step, its tick-boxes are sub-steps — so they are converted on read rather
// than left behind. A done tick-box becomes a done sub-step; anything else is
// pending, because that is what it was.
function migrateIdeas(ideas) {
  return (Array.isArray(ideas) ? ideas : []).slice(0, MAX_STEPS).map((old) => cleanStep({
    id: old && old.id,
    title: old && old.title,
    status: old && old.status === 'doing' ? 'in-progress'
          : old && old.status === 'done' ? 'done'
          : old && old.status === 'parked' ? 'not-started'
          : 'pending',
    date: old && old.date,
    note: old && old.note,
    files: old && old.files,
    subs: (old && Array.isArray(old.steps) ? old.steps : []).map((st) => ({
      title: st && st.text,
      status: st && st.done ? 'done' : 'pending',
      date: st && st.date,
    })),
  }));
}

function shape(doc) {
  const d = doc.data() || {};
  const steps = Array.isArray(d.steps) ? d.steps.slice(0, MAX_STEPS).map(cleanStep)
              : migrateIdeas(d.ideas);
  return {
    id: doc.id,
    title: d.title || 'Untitled roadmap',
    summary: d.summary || '',
    date: isoDate(d.date),
    status: status(d.status),
    note: str(d.note, MAX_NOTE),
    steps,
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
      date: '',
      status: 'not-started',
      note: '',
      steps: [],
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

  const rawSteps = Array.isArray(body.steps) ? body.steps : [];
  if (rawSteps.length > MAX_STEPS) {
    return res.status(400).json({ error: `That is more than ${MAX_STEPS} steps in one roadmap.` });
  }
  const overSubs = rawSteps.find((st) => Array.isArray(st && st.subs) && st.subs.length > MAX_SUBS);
  if (overSubs) {
    return res.status(400).json({
      error: `"${str(overSubs.title, 60) || 'A step'}" has more than ${MAX_SUBS} sub steps.`,
    });
  }

  // A note that is too long is REFUSED, not quietly shortened. Everything here
  // saves as you type, so trimming the end off a note would lose work without
  // anybody noticing until they came back for it. Being told at once is worse
  // for a second and better for ever after.
  const notes = [{ who: 'this roadmap', text: String(body.note || '') }].concat(
    rawSteps.map((st, i) => ({
      who: `"${str(st && st.title, 60) || `step ${i + 1}`}"`,
      text: String((st && st.note) || ''),
    }))
  );
  const tooLong = notes.find((n) => n.text.length > MAX_NOTE);
  if (tooLong) {
    return res.status(400).json({
      error: `The note on ${tooLong.who} is ${tooLong.text.length} characters, over the ${MAX_NOTE} limit. `
           + 'Shorten it, or attach it as a file instead.',
    });
  }

  const steps = rawSteps.map(cleanStep);

  const payload = {
    title,
    summary: str(body.summary, MAX_SUMMARY),
    date: isoDate(body.date),
    status: status(body.status),
    note: str(body.note, MAX_NOTE),
    steps,
  };
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

module.exports = { router, STATUSES, MAX_STEPS, MAX_SUBS, MAX_ROADMAPS };
