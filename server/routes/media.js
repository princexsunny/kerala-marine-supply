// The website's editable media: the five photo slots (hero, photo1, photo2,
// photo3, founder — see admin.html's SLOTS list) and one optional video.
//
// Two routers are exported because the read and write halves need different
// protection. Writes are admin-only. The READ has to be public: it's what the
// homepage calls to show the photos to ordinary visitors, and behind adminAuth
// it would 401 for everyone who isn't signed in — which is the entire audience.
//
// Everything is stored at a fixed path per slot, so re-saving a slot overwrites
// it rather than accumulating orphans, with the resulting URL recorded in
// Firestore collection "media" (doc id = slot key).
const express = require('express');
const multer = require('multer');
const { admin, init } = require('../firebase');

const router = express.Router(); // admin-only (mounted behind adminAuth)
const publicRouter = express.Router(); // readable by site visitors

const MAX_BYTES = 15 * 1024 * 1024; // generous cap for a hero/strip photo
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// Browser-playable containers only. A .mkv or .avi would upload happily and
// then silently fail to play in <video>, which looks like a broken site rather
// than a rejected file — better to refuse it up front with a clear reason.
const VIDEO_EXT_BY_TYPE = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov', // iPhone recordings; Safari plays these, Chrome usually does
};

// Held in memory before going to Storage, so this is also a peak-RAM figure.
// Render's free tier has 512 MB; 150 MB leaves room for the rest of the
// process and is far more than a homepage clip should ever need.
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
});

// ---- Public read -----------------------------------------------------------

// GET /api/media — { hero: {url, contentType}, ..., video: {url, contentType} }
// Returns {} rather than an error when nothing has been uploaded yet, so the
// homepage script has one simple contract: whatever comes back, fill what's
// there and leave the rest alone.
publicRouter.get('/media', async (req, res) => {
  try {
    init();
  } catch (e) {
    // Firebase misconfigured is a server problem, not the visitor's. Failing
    // soft here means the homepage renders without photos instead of the
    // script erroring out and potentially breaking other page behaviour.
    console.error('GET /api/media: Firebase not ready:', e.message);
    return res.json({});
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('media').get();
    const out = {};
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      if (!data.url) return;
      out[d.id] = {
        url: data.url,
        contentType: data.contentType || null,
        updatedAt:
          data.updatedAt && data.updatedAt.toDate
            ? data.updatedAt.toDate().toISOString()
            : null,
      };
    });
    // Short cache: new photos should show up within a few minutes without a
    // hard refresh, but repeat visitors shouldn't re-fetch this on every page.
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json(out);
  } catch (err) {
    console.error('GET /api/media failed:', err);
    res.json({});
  }
});

// ---- Admin writes ----------------------------------------------------------

// PUT /api/media — body is a flat { slotKey: "data:image/...;base64,..." }.
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

// POST /api/media/video (multipart, field "file") — replaces the site video.
// Multipart rather than a base64 JSON body like the photos: base64 inflates by
// ~37%, which on a 100 MB clip means a 137 MB JSON string held in memory and
// parsed as one value. Streaming the raw bytes through multer avoids that.
router.post('/media/video', uploadVideo.single('file'), async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video was uploaded.' });
    }
    const contentType = req.file.mimetype || '';
    const ext = VIDEO_EXT_BY_TYPE[contentType];
    if (!ext) {
      return res.status(400).json({
        error: 'That file type will not play in a web browser. Use MP4 (best), WebM or MOV.',
      });
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    // Fixed path per slot, so uploading a new video replaces the old one.
    // The extension can change between uploads (mp4 -> webm), which would
    // leave the previous file orphaned in Storage — so delete whatever the
    // current record points at first, unless it's the same path we're about
    // to overwrite anyway.
    const storagePath = `media/video.${ext}`;
    const prev = await db.collection('media').doc('video').get();
    const prevPath = prev.exists && prev.data() ? prev.data().storagePath : null;
    if (prevPath && prevPath !== storagePath) {
      try {
        await bucket.file(prevPath).delete();
      } catch (e) {
        if (e.code !== 404) throw e;
      }
    }

    const file = bucket.file(storagePath);
    await file.save(req.file.buffer, {
      contentType,
      metadata: { cacheControl: 'public, max-age=300' },
    });
    const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

    await db.collection('media').doc('video').set({
      url,
      storagePath,
      contentType,
      name: req.file.originalname || `video.${ext}`,
      size: req.file.size,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, url, size: req.file.size });
  } catch (err) {
    console.error('POST /api/media/video failed:', err);
    res.status(500).json({ error: 'Could not save the video. Please try again.' });
  }
});

// DELETE /api/media/video — removes the video from the site.
router.delete('/media/video', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('media').doc('video');
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'There is no video to remove.' });
    }

    const data = snap.data() || {};
    // File first, then the record — same reasoning as document delete: if the
    // file delete fails, the video stays listed so it can be retried, rather
    // than leaving an unreachable file behind with nothing pointing at it.
    if (data.storagePath) {
      try {
        await bucket.file(data.storagePath).delete();
      } catch (e) {
        if (e.code !== 404) throw e;
      }
    }

    await ref.delete();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/media/video failed:', err);
    res.status(500).json({ error: 'Could not remove the video. Please try again.' });
  }
});

module.exports = { router, publicRouter, MAX_VIDEO_BYTES };
