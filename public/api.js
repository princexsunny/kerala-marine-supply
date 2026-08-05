// Thin client for the Express + Firebase backend. apply.html already calls
// window.KMS.applyJob(app) if window.KMS exists (see its submit handler) —
// this file is what makes that call real, sending the application to
// POST /api/apply so it's saved server-side (Firestore + Storage) instead
// of only sitting in this browser's localStorage.
window.KMS = (function () {
  function applyJob(app) {
    return fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(app),
    }).then(function (res) {
      if (!res.ok) {
        return res
          .json()
          .catch(function () { return {}; })
          .then(function (body) {
            throw new Error(body.error || 'Request failed (' + res.status + ')');
          });
      }
      return res.json();
    });
  }

  return { applyJob: applyJob };
})();
