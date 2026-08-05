// Firebase Admin SDK bootstrap — Firestore (database) + Storage (files).
// Reads credentials from env vars (see .env.example). Throws a clear error
// if they're missing instead of failing with a cryptic Firebase message.
const admin = require('firebase-admin');

let app = null;
let initError = null;

function init() {
  if (app) return app;
  if (initError) throw initError;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Service-account private keys are stored in env vars as a single line
  // with literal "\n" — turn those back into real newlines.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey || !storageBucket) {
    initError = new Error(
      'Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, ' +
      'FIREBASE_PRIVATE_KEY and FIREBASE_STORAGE_BUCKET (see .env.example).'
    );
    throw initError;
  }

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      storageBucket,
    });
  } catch (e) {
    initError = e;
    throw e;
  }
  return app;
}

function isReady() {
  if (app) return true;
  try {
    init();
    return true;
  } catch {
    return false;
  }
}

module.exports = { admin, init, isReady };
