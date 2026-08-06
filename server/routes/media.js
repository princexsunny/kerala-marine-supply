// PUT /api/media — saves the website's editable photo slots (hero, photo1,
// photo2, photo3, founder — see admin.html's SLOTS list). Body is a flat
// object of { slotKey: "data:image/...;base64,..." }. Each photo is stored
// in Firebase Storage at a fixed path per slot (so re-saving a slot just
// overwrites it) and the resulting URL is recorded in Firestore under
// collection "media", doc id = slot key.
const express = require('express');
const router = express.Router();
const { admin, init } = require('../firebase');

const MAX_BYTES = 15 * 1024 * 1024; // generous cap for a hero/strip photo
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

router.put('/media', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const photos = req.body || {};
    const keys = Object.keys(photos);

    if (!keys.length) {
      return res.status(400).json({ error: 'No photos were sent.' });
    }

    const saved = [];
    for (const key of keys) {
      const dataUrl = photos[key];
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
      if (!match) continue;
      const [, contentType, base64] = match;
      const ext = EXT_BY_TYPE[contentType];
      if (!ext) continue;
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > MAX_BYTES) {
        return res.status(400).json({ error: `${key}: photo exceeds the size limit.` });
      }
      const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
      const storagePath = `media/${safeKey}.${ext}`;
      const file = bucket.file(storagePath);
      await file.save(buffer, { contentType, metadata: { cacheControl: 'public, max-age=300' } });
      const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });
      await db.collection('media').doc(safeKey).set({
        url,
        storagePath,
        contentType,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      saved.push(safeKey);
    }

    if (!saved.length) {
      return res.status(400).json({ error: 'None of the photos were a supported image type (JPEG, PNG, WebP, GIF).' });
    }
    res.json({ ok: true, saved });
  } catch (err) {
    console.error('PUT /api/media failed:', err);
    res.status(500).json({ error: 'Could not save photos. Please try again.' });
  }
});

module.exports = router;
