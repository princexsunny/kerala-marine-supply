// POST /api/documents (multipart: category, file) and GET /api/documents —
// the document library used by Admin.dc.html / admin.html (licences, LOIs,
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

module.exports = router;
