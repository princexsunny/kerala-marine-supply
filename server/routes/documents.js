// POST /api/documents (multipart: category, file) and GET /api/documents —
// the document library used by admin.html (licences, LOIs,
// quotations, investor deck, etc.). Files go to Firebase Storage, metadata
// to Firestore collection "documents".
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { admin, init } = require('../firebase');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB, matches the admin UI copy
});

router.post('/documents', upload.single('file'), async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    const category = (req.body && req.body.category) || 'Other';
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const safeCategory = String(category).trim() || 'Other';
    const safeName = String(req.file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `documents/${safeCategory}/${Date.now()}-${safeName}`;
    const file = bucket.file(storagePath);
    await file.save(req.file.buffer, {
      contentType: req.file.mimetype || 'application/octet-stream',
      metadata: { cacheControl: 'private, max-age=0' },
    });
    const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

    const doc = {
      name: req.file.originalname || safeName,
      category: safeCategory,
      type: req.file.mimetype || 'application/octet-stream',
      size: req.file.size,
      url,
      storagePath,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('documents').add(doc);
    res.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('POST /api/documents failed:', err);
    res.status(500).json({ error: 'Could not upload the document. Please try again.' });
  }
});

router.get('/documents', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('documents').orderBy('createdAt', 'desc').get();
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        category: data.category,
        type: data.type,
        size: data.size,
        url: data.url,
      };
    });
    res.json(list);
  } catch (err) {
    console.error('GET /api/documents failed:', err);
    res.status(500).json({ error: 'Could not load documents.' });
  }
});

// PATCH /api/documents/:id — rename a document, or move it to another
// category. The stored FILE is untouched: only the label and the filing
// change. Renaming the object in Storage would break the signed URL that is
// already recorded, and there is no reason to move bytes to change a name.
const MAX_NAME = 160;
const MAX_CATEGORY = 60;

router.patch('/documents/:id', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const body = req.body || {};
  const patch = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.status(400).json({ error: 'A document needs a name.' });
    if (name.length > MAX_NAME) {
      return res.status(400).json({ error: `That name is too long (${MAX_NAME} characters maximum).` });
    }
    patch.name = name;
  }

  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) return res.status(400).json({ error: 'Pick a category.' });
    if (category.length > MAX_CATEGORY) {
      return res.status(400).json({ error: `That category name is too long (${MAX_CATEGORY} characters maximum).` });
    }
    patch.category = category;
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to change.' });
  }

  try {
    const ref = admin.firestore().collection('documents').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'That document is no longer here.' });
    await ref.update(patch);
    res.json({ ok: true, ...patch });
  } catch (err) {
    console.error('PATCH /api/documents failed:', err);
    res.status(500).json({ error: 'Could not save the change.' });
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('documents').doc(req.params.id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'That document no longer exists.' });
    }

    const data = snap.data();

    // Delete the stored file first. If this fails the Firestore record is
    // left alone, so the document still appears in the admin list and the
    // delete can be retried — the alternative (record gone, file orphaned)
    // would silently leak storage with no way to find it again.
    if (data.storagePath) {
      try {
        await bucket.file(data.storagePath).delete();
      } catch (e) {
        // Already-missing file (404) is fine — the goal is that it's gone.
        if (e.code !== 404) throw e;
      }
    }

    await ref.delete();
    res.json({ ok: true, deleted: data.name || req.params.id });
  } catch (err) {
    console.error('DELETE /api/documents failed:', err);
    res.status(500).json({ error: 'Could not delete the document. Please try again.' });
  }
});

module.exports = router;
