// POST /api/apply — receives the job-application payload built by
// public/apply.html (see public/api.js: window.KMS.applyJob), stores the
// resume file in Firebase Storage and the application record in Firestore.
const express = require('express');
const router = express.Router();
const { admin, init } = require('../firebase');

const MAX_BYTES = 2 * 1024 * 1024; // matches apply.html's 2 MB client-side cap

router.post('/apply', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();

    const body = req.body || {};
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();
    const email = (body.email || '').trim();
    const role = (body.role || 'General Application').trim();
    const message = (body.message || '').trim();
    const resumeName = body.resumeName || '';
    const resumeData = body.resumeData || '';

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required.' });
    }
    if (!resumeData || !resumeName) {
      return res.status(400).json({ error: 'Resume is required.' });
    }

    const match = /^data:([^;]+);base64,(.+)$/.exec(resumeData);
    if (!match) {
      return res.status(400).json({ error: 'Resume data is not a valid file.' });
    }
    const [, contentType, base64] = match;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ error: 'Resume exceeds 2 MB.' });
    }

    const safeName = String(resumeName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `resumes/${Date.now()}-${safeName}`;
    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType, metadata: { cacheControl: 'private, max-age=0' } });
    const [resumeUrl] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

    const record = {
      name,
      phone,
      email,
      role,
      message,
      resumeName: safeName,
      resumeUrl,
      resumePath: storagePath,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('applications').add(record);
    res.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('POST /api/apply failed:', err);
    res.status(500).json({ error: 'Could not save the application. Please try again shortly.' });
  }
});

module.exports = router;
