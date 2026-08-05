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

module.exports = router;
