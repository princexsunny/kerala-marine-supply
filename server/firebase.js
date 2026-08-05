// Firebase Admin SDK bootstrap — Firestore (database) + Storage (files).
//
// Credentials are accepted in EITHER of two shapes, so the same code runs
// locally and on a Render service that was configured for the older version
// of this project:
//
//   A) FIREBASE_SERVICE_ACCOUNT  — the whole service-account JSON in one
//      variable (raw JSON, or base64-encoded JSON). This is what Render
//      already has set.
//   B) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
//      — the split form that `npm run setup` writes into .env locally.
//
// A wins if both are present. Either way a missing/!malformed config raises a
// clear error rather than a cryptic one from deep inside the SDK.
const admin = require('firebase-admin');

let app = null;
let initError = null;

function parseServiceAccountBlob(raw) {
  let text = String(raw).trim();
  // Tolerate a value that was wrapped in quotes when pasted into a dashboard.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  // Base64 is a common way to avoid newline mangling in env-var UIs.
  if (!text.startsWith('{')) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
      if (decoded.startsWith('{')) text = decoded;
    } catch {
      /* fall through to the JSON parse error below */
    }
  }
  let sa;
  try {
    sa = JSON.parse(text);
  } catch (e) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON. It should be the ' +
        'entire contents of the service-account key file (or that JSON base64-encoded).'
    );
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is valid JSON but is missing project_id, ' +
        'client_email or private_key — it may not be a service-account key file.'
    );
  }
  return {
    projectId: sa.project_id,
    clientEmail: sa.client_email,
    // Whether the key arrives with real newlines (JSON.parse of a raw blob)
    // or literal \n (a dashboard-pasted single line), normalize to real ones.
    privateKey: String(sa.private_key).replace(/\\n/g, '\n'),
  };
}

function loadCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return parseServiceAccountBlob(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // Service-account private keys are stored in env vars as a single line
  // with literal "\n" — turn those back into real newlines.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase is not configured. Set either FIREBASE_SERVICE_ACCOUNT (the whole ' +
        'service-account JSON) or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + ' +
        'FIREBASE_PRIVATE_KEY (see .env.example).'
    );
  }
  return { projectId, clientEmail, privateKey };
}

function init() {
  if (app) return app;
  if (initError) throw initError;

  try {
    const creds = loadCredentials();

    // Explicit setting wins; otherwise derive from the project id. Buckets
    // created since Oct 2024 are <project>.firebasestorage.app, older ones
    // <project>.appspot.com — so the guess is only a last resort.
    const storageBucket =
      process.env.FIREBASE_STORAGE_BUCKET || creds.projectId + '.firebasestorage.app';

    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
      storageBucket,
    });
    // Handy for logs / the health check, without re-parsing the blob later.
    app.__kmsProjectId = creds.projectId;
    app.__kmsBucket = storageBucket;
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
