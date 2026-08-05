#!/usr/bin/env node
/**
 * Verifies the Firebase setup for real: writes a document, reads it back,
 * deletes it, then confirms the Storage bucket is reachable and writable.
 *
 *   npm run check
 *
 * Every failure is translated into the specific thing to go fix, because
 * the raw Firebase errors for "wrong private key" and "billing not enabled"
 * are both unhelpful in their own way.
 */
require('dotenv').config();
const { admin, init } = require('../server/firebase');

const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => console.log('  ✗ ' + m);

function explain(err) {
  const msg = (err && err.message) || String(err);
  const code = (err && (err.code || err.errorInfo?.code)) || '';

  // Our own "you haven't filled in .env yet" error already says exactly what
  // to do. It must be matched FIRST: it names the env vars, and one of them
  // is FIREBASE_STORAGE_BUCKET, which would otherwise trip the bucket branch
  // below and print a completely misleading diagnosis.
  if (/Firebase is not configured/i.test(msg)) {
    return msg + '\n      Quickest path: npm run setup';
  }
  if (
    /Failed to parse private key|Too few bytes to parse DER|DECODER routines|error:1E08010C|Invalid PEM|asn1|invalid-credential/i.test(
      msg
    ) ||
    /invalid-credential/i.test(code)
  ) {
    return (
      'The private key is malformed.\n' +
      '      In .env, FIREBASE_PRIVATE_KEY must be one line wrapped in double\n' +
      '      quotes, with literal \\n between the BEGIN/END markers — not real\n' +
      '      line breaks. Easiest fix: npm run setup -- --force'
    );
  }
  if (/invalid_grant|Invalid JWT|invalid signature/i.test(msg)) {
    return (
      'Firebase rejected the credentials.\n' +
      '      The key may have been revoked, or belongs to a different project.\n' +
      '      Generate a fresh one and re-run: npm run setup -- --force'
    );
  }
  if (/billing|Blaze|has not been used in project|accountDisabled|is disabled/i.test(msg)) {
    return (
      'The service is not enabled or billing is not active.\n' +
      '      Cloud Storage requires the Blaze plan on projects created after\n' +
      '      Oct 2024. Enable it in the Firebase console, then retry.'
    );
  }
  // Narrow on purpose — must look like a real bucket lookup failure, not any
  // message that merely contains the word "bucket".
  if (
    /bucket \S+ does not exist/i.test(msg) ||
    /The specified bucket does not exist/i.test(msg) ||
    (/NOT_FOUND/i.test(msg) && /bucket/i.test(msg))
  ) {
    return (
      'That bucket does not exist.\n' +
      '      Check the exact name on the Storage page in the Firebase console\n' +
      '      and set FIREBASE_STORAGE_BUCKET in .env to match. Newer projects\n' +
      '      use <project>.firebasestorage.app; older ones .appspot.com.'
    );
  }
  if (/PERMISSION_DENIED|forbidden/i.test(msg)) {
    return (
      'Permission denied.\n' +
      '      Confirm Firestore and Storage are both enabled in the console for\n' +
      '      project "' + (process.env.FIREBASE_PROJECT_ID || '?') + '".'
    );
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network/i.test(msg)) {
    return 'Network problem reaching Firebase. Check your internet connection.';
  }
  return msg + (code ? ' (' + code + ')' : '');
}

async function main() {
  console.log('\n  Checking Firebase setup…\n');

  try {
    init();
    ok('Credentials loaded for project: ' + process.env.FIREBASE_PROJECT_ID);
  } catch (e) {
    bad('Configuration problem');
    console.log('\n      ' + explain(e) + '\n');
    process.exit(1);
  }

  let failures = 0;

  // --- Firestore: full write / read / delete round trip ---
  try {
    const db = admin.firestore();
    const ref = db.collection('_healthcheck').doc('probe');
    const stamp = Date.now();
    await ref.set({ stamp, note: 'written by npm run check' });
    const snap = await ref.get();
    if (!snap.exists || snap.data().stamp !== stamp) {
      throw new Error('Document did not read back correctly.');
    }
    await ref.delete();
    ok('Firestore — wrote, read and deleted a test document');
  } catch (e) {
    failures++;
    bad('Firestore failed');
    console.log('\n      ' + explain(e) + '\n');
  }

  // --- Storage: upload / download / delete round trip ---
  try {
    const bucket = admin.storage().bucket();
    const [exists] = await bucket.exists();
    if (!exists) {
      throw new Error('bucket ' + bucket.name + ' does not exist');
    }
    const file = bucket.file('_healthcheck/probe.txt');
    await file.save(Buffer.from('written by npm run check'), {
      contentType: 'text/plain',
    });
    const [contents] = await file.download();
    if (!contents.toString().includes('npm run check')) {
      throw new Error('File did not read back correctly.');
    }
    await file.delete();
    ok('Storage — uploaded, downloaded and deleted a test file');
    ok('Bucket: ' + bucket.name);
  } catch (e) {
    failures++;
    bad('Storage failed');
    console.log('\n      ' + explain(e) + '\n');
  }

  // --- Admin password sanity ---
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    failures++;
    bad('ADMIN_PASSWORD is not set — the admin page will return an error.');
  } else if (pw.length < 10 || /^(change|password|admin|test)/i.test(pw)) {
    console.log('  ! ADMIN_PASSWORD looks weak — consider a longer random one.');
  } else {
    ok('Admin password is set');
  }

  if (failures) {
    console.log('\n  ' + failures + ' check(s) failed — fix the above, then re-run.\n');
    process.exit(1);
  }
  console.log('\n  Everything works. Start the site with:  npm start\n');
  process.exit(0);
}

main().catch((e) => {
  bad('Unexpected error');
  console.log('\n      ' + explain(e) + '\n');
  process.exit(1);
});
