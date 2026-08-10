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

// A slot is a slideshow, not a single picture, so it needs a ceiling. Twelve is
// enough to tell any of these stories and still small enough that a visitor on
// mobile data is not made to download a photo album to read the homepage — the
// slideshow only fetches each one as it comes round, but the cap is what stops
// a slot growing without limit.
const MAX_PHOTOS_PER_SLOT = 12;
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

// ---- Slot shape ------------------------------------------------------------
//
// A media doc holds `items: [{ id, url, storagePath, contentType }]`.
//
// The top-level url/storagePath/contentType are kept in step with items[0].
// They are not redundant: every photo saved before this change is stored that
// way and has no items array at all, and venture.html reads `.url` directly.
// Mirroring means old records keep working untouched and nothing has to be
// migrated by hand — readItems() below promotes a legacy doc to a one-item
// slideshow on the fly.
function readItems(data) {
  if (!data) return [];
  if (Array.isArray(data.items) && data.items.length) {
    return data.items.filter(function (it) { return it && it.url; });
  }
  if (data.url) {
    return [{
      id: idFor(data.storagePath),
      url: data.url,
      storagePath: data.storagePath || null,
      contentType: data.contentType || null,
    }];
  }
  return [];
}

// A stable handle for one photo inside a slot, used by the delete route.
// Derived from the storage filename rather than the array index, because an
// index shifts the moment anything else in the slot is removed — and a delete
// that acts on a stale index removes the wrong picture.
function idFor(storagePath) {
  if (!storagePath) return null;
  const base = String(storagePath).split('/').pop() || '';
  return base.replace(/\.[^.]+$/, '') || null;
}

// items[] plus the mirrored first-item fields, as one object to write.
function slotDoc(items) {
  const first = items[0] || null;
  return {
    items,
    url: first ? first.url : null,
    storagePath: first ? first.storagePath : null,
    contentType: first ? first.contentType : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

// Decode one "data:image/jpeg;base64,..." string, or return null with a reason.
function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return { error: 'not an image' };
  const [, contentType, base64] = match;
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) return { error: 'unsupported type' };
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_BYTES) return { error: 'too large' };
  return { contentType, ext, buffer };
}

// Upload one decoded photo and return its item record.
async function storePhoto(bucket, safeKey, decoded, seq) {
  // Unique filename per upload, NOT a fixed `media/hero.jpg`.
  //
  // With a fixed name the signed URL never changed, so replacing a photo left
  // every browser and CDN still holding the previous image under an identical
  // URL — which is why a refreshed page showed the old photo first and only
  // switched once the cache expired. A new name means a new URL, so a
  // replacement is visible immediately and the file itself can still be
  // cached hard. The counter distinguishes photos saved within the same
  // millisecond, which is exactly what a multi-file upload does.
  const stamp = Date.now().toString(36) + (seq ? '-' + seq : '');
  const storagePath = `media/${safeKey}-${stamp}.${decoded.ext}`;
  const file = bucket.file(storagePath);
  await file.save(decoded.buffer, {
    contentType: decoded.contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  const [url] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });
  return { id: idFor(storagePath), url, storagePath, contentType: decoded.contentType };
}

// Remove files that are no longer referenced by any item in the slot. Called
// only after the record has been updated, so a failure here leaves an orphaned
// file rather than a broken photo.
async function removeFiles(bucket, paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      await bucket.file(p).delete();
    } catch (e) {
      if (e.code !== 404) console.warn('Could not remove old media', p, e.message);
    }
  }
}

// ---- Public read -----------------------------------------------------------

// GET /api/media — { hero: {url, contentType}, ..., video: {url, contentType} }
// Returns {} rather than an error when nothing has been uploaded yet, so the
// homepage script has one simple contract: whatever comes back, fill what's
// there and leave the rest alone.
publicRouter.get('/media', async (req, res) => {
  // Set on every path, including the failure ones below. An empty {} response
  // must never be cached — otherwise a momentary Firebase problem would leave
  // visitors with a photo-less homepage long after it recovered.
  res.setHeader('Cache-Control', 'no-cache');

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
      const items = readItems(data);
      if (!items.length) return;
      out[d.id] = {
        // items[] is what the slideshow reads. url/contentType stay at the top
        // level so anything still expecting one picture keeps working.
        url: items[0].url,
        contentType: items[0].contentType || null,
        items: items.map((it) => ({
          id: it.id || idFor(it.storagePath),
          url: it.url,
          contentType: it.contentType || null,
        })),
        updatedAt:
          data.updatedAt && data.updatedAt.toDate
            ? data.updatedAt.toDate().toISOString()
            : null,
      };
    });
    // Must revalidate every load. The payload is tiny, and caching it was
    // part of why a replaced photo kept showing the old image: a stale copy
    // of this JSON hands out the previous upload's URL. The image files
    // themselves are still cached hard — they're now uniquely named, so a
    // new upload is always a new URL and can never collide with a cached one.
    res.setHeader('Cache-Control', 'no-cache');
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
      const decoded = decodeDataUrl(photos[key]);
      if (decoded.error === 'too large') {
        return res.status(400).json({ error: `${key}: photo exceeds the size limit.` });
      }
      if (decoded.error) continue;

      const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');

      // Note what the slot held before, so those files can be cleaned up once
      // the new one is safely stored and recorded.
      const prevSnap = await db.collection('media').doc(safeKey).get();
      const prevPaths = readItems(prevSnap.exists ? prevSnap.data() : null)
        .map((it) => it.storagePath);

      const item = await storePhoto(bucket, safeKey, decoded);
      await db.collection('media').doc(safeKey).set(slotDoc([item]));

      await removeFiles(bucket, prevPaths.filter((p) => p !== item.storagePath));
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

// POST /api/media/:slot/photos — ADD photos to a slot, keeping what is there.
//
// Separate from PUT above rather than a flag on it, because the two are
// genuinely different acts: PUT means "this slot is now this picture", and
// getting an accidental replace when you meant to add would silently destroy
// work. The names say which is which.
router.post('/media/:slot/photos', async (req, res) => {
  const slot = String(req.params.slot);
  if (PHOTO_SLOTS.indexOf(slot) === -1) {
    return res.status(400).json({ error: 'Unknown photo slot.' });
  }

  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const list = Array.isArray(req.body && req.body.photos) ? req.body.photos : [];
    if (!list.length) {
      return res.status(400).json({ error: 'No photos were sent.' });
    }

    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('media').doc(slot);
    const snap = await ref.get();
    const existing = readItems(snap.exists ? snap.data() : null);

    const room = MAX_PHOTOS_PER_SLOT - existing.length;
    if (room <= 0) {
      return res.status(400).json({
        error: `That slot already holds ${MAX_PHOTOS_PER_SLOT} photos, the maximum. Remove one first.`,
      });
    }
    if (list.length > room) {
      return res.status(400).json({
        error: `Only ${room} more photo${room === 1 ? '' : 's'} will fit in that slot (${MAX_PHOTOS_PER_SLOT} maximum).`,
      });
    }

    // Decode everything BEFORE uploading anything, so a rejected file fails the
    // request outright instead of leaving half a batch in storage.
    const decoded = [];
    for (let i = 0; i < list.length; i++) {
      const d = decodeDataUrl(list[i]);
      if (d.error === 'too large') {
        return res.status(400).json({ error: `Photo ${i + 1} is larger than the 15 MB limit.` });
      }
      if (d.error) {
        return res.status(400).json({ error: `Photo ${i + 1} is not a JPEG, PNG, WebP or GIF.` });
      }
      decoded.push(d);
    }

    const added = [];
    for (let i = 0; i < decoded.length; i++) {
      added.push(await storePhoto(bucket, slot, decoded[i], i + 1));
    }

    const items = existing.concat(added);
    await ref.set(slotDoc(items));
    res.json({ ok: true, added: added.length, total: items.length, items });
  } catch (err) {
    console.error('POST /api/media/:slot/photos failed:', err);
    res.status(500).json({ error: 'Could not add the photos. Please try again.' });
  }
});

// DELETE /api/media/:slot/photos/:id — remove ONE photo from a slot.
//
// Addressed by id (the storage filename), never by position: a position is
// only valid against the list the admin page happened to be showing, and if
// anything changed in between it would delete a different picture than the one
// whose cross was clicked.
router.delete('/media/:slot/photos/:id', async (req, res) => {
  const slot = String(req.params.slot);
  const id = String(req.params.id);
  if (PHOTO_SLOTS.indexOf(slot) === -1) {
    return res.status(400).json({ error: 'Unknown photo slot.' });
  }

  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('media').doc(slot);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'There are no photos in that slot.' });
    }

    const items = readItems(snap.data());
    const gone = items.filter((it) => (it.id || idFor(it.storagePath)) === id);
    if (!gone.length) {
      return res.status(404).json({ error: 'That photo is no longer in this slot.' });
    }
    const kept = items.filter((it) => (it.id || idFor(it.storagePath)) !== id);

    // Record first, file second. If the file delete fails the slot is already
    // correct on the site and only an unused file is left behind, which is the
    // harmless failure of the two.
    if (kept.length) {
      await ref.set(slotDoc(kept));
    } else {
      await ref.delete();
    }
    await removeFiles(bucket, gone.map((it) => it.storagePath));

    res.json({ ok: true, remaining: kept.length, items: kept });
  } catch (err) {
    console.error('DELETE /api/media/:slot/photos/:id failed:', err);
    res.status(500).json({ error: 'Could not remove the photo. Please try again.' });
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

    // Unique filename per upload, for the same reason as the photos: a fixed
    // name would keep serving the previous video from cache under an
    // unchanged URL. The old file is deleted below, after the new one is
    // stored and the record updated.
    const stamp = Date.now().toString(36);
    const storagePath = `media/video-${stamp}.${ext}`;
    const prev = await db.collection('media').doc('video').get();
    const prevPath = prev.exists && prev.data() ? prev.data().storagePath : null;

    const file = bucket.file(storagePath);
    await file.save(req.file.buffer, {
      contentType,
      metadata: { cacheControl: 'public, max-age=31536000' },
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

    if (prevPath && prevPath !== storagePath) {
      try {
        await bucket.file(prevPath).delete();
      } catch (e) {
        if (e.code !== 404) console.warn('Could not remove old video', prevPath, e.message);
      }
    }

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

// DELETE /api/media/:slot — clear one photo slot (hero, photo1…, founder).
//
// Declared AFTER /media/video above, so "video" matches that specific route
// first and is never treated as a photo slot here.
// orbit1..orbit5 back the hero orbit navigation's five categories. orbit3
// (Boat yard) is intentionally absent: that category always shows the main
// hero photograph, so it has no separate slot to upload or delete.
// Slots that exist on the site today. The homepage was redesigned and no
// longer has the three strip photos or the hero-orbit categories, so those
// were removed rather than left as uploads that lead nowhere.
const PHOTO_SLOTS = [
  'hero', 'founder',
  'venture1', 'venture2', 'venture3', 'venture4', 'venture5', 'venture6',
  'venture7', 'venture8', 'venture9', 'venture10', 'venture11', 'venture12',
];

router.delete('/media/:slot', async (req, res) => {
  const slot = String(req.params.slot);
  // Whitelist rather than sanitise: this deletes files, so an unexpected
  // value should be refused outright, not cleaned up and acted on. Checked
  // BEFORE touching Firebase so a bad slot is always a clear 400, rather than
  // a confusing 500 whenever the backend happens to be unreachable.
  if (PHOTO_SLOTS.indexOf(slot) === -1) {
    return res.status(400).json({ error: 'Unknown photo slot.' });
  }

  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('media').doc(slot);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'There is no photo in that slot.' });
    }

    // Every photo in the slot, not just the first one — a slot is a slideshow
    // now, and clearing it while leaving the other files behind would quietly
    // accumulate storage nobody can see or reach.
    const items = readItems(snap.data());

    // File first, then the record — if the file delete fails the photo stays
    // listed so it can be retried, rather than leaving an unreachable file.
    await removeFiles(bucket, items.map((it) => it.storagePath));

    await ref.delete();
    res.json({ ok: true, deleted: slot, removed: items.length });
  } catch (err) {
    console.error('DELETE /api/media/:slot failed:', err);
    res.status(500).json({ error: 'Could not remove the photo. Please try again.' });
  }
});

module.exports = { router, publicRouter, MAX_VIDEO_BYTES };
