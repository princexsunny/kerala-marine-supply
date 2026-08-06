// GET /api/applications — admin-only list of submitted job applications
// (protected by adminAuth in server/index.js). Used by public/admin.html.
const express = require('express');
const router = express.Router();
const { admin, init } = require('../firebase');

router.get('/applications', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('applications').orderBy('createdAt', 'desc').get();
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        role: data.role,
        message: data.message,
        resumeName: data.resumeName,
        resumeUrl: data.resumeUrl,
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : null,
      };
    });
    res.json(list);
  } catch (err) {
    console.error('GET /api/applications failed:', err);
    res.status(500).json({ error: 'Could not load applications.' });
  }
});

router.delete('/applications/:id', async (req, res) => {
  try {
    init();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  try {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const ref = db.collection('applications').doc(req.params.id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'That application no longer exists.' });
    }

    const data = snap.data();

    // Delete the resume file first, same reasoning as document delete: if this
    // fails, leave the Firestore record in place so the entry (and its resume)
    // stays visible and the delete can be retried, instead of silently
    // orphaning a file in Storage with no record pointing at it.
    if (data.resumePath) {
      try {
        await bucket.file(data.resumePath).delete();
      } catch (e) {
        if (e.code !== 404) throw e;
      }
    }

    await ref.delete();
    res.json({ ok: true, deleted: data.name || req.params.id });
  } catch (err) {
    console.error('DELETE /api/applications failed:', err);
    res.status(500).json({ error: 'Could not delete the application. Please try again.' });
  }
});

module.exports = router;
