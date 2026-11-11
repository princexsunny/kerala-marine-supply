(function () {
  'use strict';
  var sender = 'princexsunny@gmail.com';
  function messageFor(kind, application) {
    var name = String(application.name || 'Applicant').replace(/[\r\n]+/g, ' ');
    var role = String(application.role || 'the advertised role').replace(/[\r\n]+/g, ' ');
    var messages = {
      received: ['Application received — ' + role, 'Thank you for applying for ' + role + '. We have received your application and resume. We will review them and contact you if we need more information or would like to arrange an interview.'],
      interview: ['Interview invitation — ' + role, 'Thank you for your application for ' + role + '. We would like to invite you for an interview. Please reply with your availability and preferred contact number so we can confirm the date, time and meeting details.'],
      details: ['More information about your application — ' + role, 'Thank you for applying for ' + role + '. Could you please reply with a brief summary of your relevant experience, your availability to join and your preferred contact number?'],
      declined: ['Update on your application — ' + role, 'Thank you for your interest in ' + role + ' and for taking the time to apply. After reviewing your application, we will not be moving forward with it for this position. We appreciate your interest and wish you the best in your job search.'],
      custom: ['Your application — ' + role, '']
    };
    var template = messages[kind] || messages.received;
    return { subject: template[0], body: 'Dear ' + name + ',\n\n' + template[1] + '\n\nRegards,\nPrince Sunny\nShalom Group | Kerala Marine Supply' };
  }
  function composeUrl(email, subject, body) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('This applicant does not have a valid email address.');
    if (!subject.trim() || /[\r\n]/.test(subject)) throw new Error('Enter a subject on one line.');
    if (!body.trim()) throw new Error('Enter your message before opening Gmail.');
    var query = new URLSearchParams({ authuser: sender, view: 'cm', fs: '1', to: email, su: subject, body: body });
    return 'https://mail.google.com/mail/?' + query.toString();
  }
  // Export the pure message/URL helpers for regression checks without a browser.
  if (typeof module !== 'undefined' && module.exports) { module.exports = { messageFor: messageFor, composeUrl: composeUrl }; return; }
  var dialog = document.createElement('dialog');
  dialog.id = 'applicationReplyDialog';
  dialog.setAttribute('aria-labelledby', 'applicationReplyTitle');
  dialog.innerHTML = '<form id="applicationReplyForm"><h2 id="applicationReplyTitle">Reply to application</h2>' +
    '<p id="applicationReplyApplicant"></p><p>From: <strong>' + sender + '</strong></p>' +
    '<label>Ready message<select id="applicationReplyTemplate"><option value="received">Application received</option><option value="interview">Interview invitation</option><option value="details">Request more details</option><option value="declined">Not selected</option><option value="custom">Write my own</option></select></label>' +
    '<label>To<input id="applicationReplyTo" type="email" readonly required></label>' +
    '<label>Subject<input id="applicationReplySubject" required maxlength="200"></label>' +
    '<label>Message<textarea id="applicationReplyBody" rows="11" required maxlength="10000"></textarea></label>' +
    '<p class="note">Review and edit here, then send in Gmail. Check that Gmail is using princexsunny@gmail.com. Opening Gmail does not send the message. This editor keeps your text until this page is closed or refreshed.</p>' +
    '<p id="applicationReplyStatus" role="status"></p><div class="reply-actions"><button type="button" id="applicationReplyClose" class="btn btn-secondary">Close</button><button type="submit" class="btn btn-primary">Review &amp; send in Gmail ↗</button></div></form>';
  document.body.appendChild(dialog);
  var css = document.createElement('style');
  css.textContent = '#applicationReplyDialog{width:min(620px,calc(100vw - 32px));max-height:90vh;box-sizing:border-box;overflow:auto;border:1px solid var(--color-divider);border-radius:16px;padding:24px;background:var(--color-bg);color:var(--color-text)}#applicationReplyDialog::backdrop{background:#0007}#applicationReplyDialog h2{margin-top:0}#applicationReplyDialog label{display:block;font-weight:600;margin:14px 0}#applicationReplyDialog input,#applicationReplyDialog select,#applicationReplyDialog textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid var(--color-divider);border-radius:8px;background:white;color:inherit;font:inherit}#applicationReplyDialog textarea{resize:vertical;line-height:1.5}.reply-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}';
  document.head.appendChild(css);
  var $ = function (id) { return document.getElementById(id); }, current, dirty = false, drafts = new Map();
  function retain() { if (current) drafts.set(current.id, { subject: $('applicationReplySubject').value, body: $('applicationReplyBody').value, kind: $('applicationReplyTemplate').value, dirty: dirty }); }
  function populate(kind) { var text = messageFor(kind, current); $('applicationReplySubject').value = text.subject; $('applicationReplyBody').value = text.body; dirty = false; }
  $('applicationReplyTemplate').addEventListener('change', function () {
    if (dirty && !confirm('Replace your edited message with this ready message?')) { this.value = this.dataset.previous || 'received'; return; }
    populate(this.value); this.dataset.previous = this.value;
  });
  ['applicationReplySubject', 'applicationReplyBody'].forEach(function (id) { $(id).addEventListener('input', function () { dirty = true; retain(); }); });
  $('applicationReplyClose').onclick = function () { retain(); dialog.close(); };
  dialog.addEventListener('cancel', retain);
  $('applicationReplyForm').addEventListener('submit', function (event) {
    event.preventDefault();
    try {
      var url = composeUrl($('applicationReplyTo').value, $('applicationReplySubject').value, $('applicationReplyBody').value);
      retain();
      var link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; document.body.appendChild(link); link.click(); link.remove();
      $('applicationReplyStatus').textContent = 'Continue in Gmail to review and send. If no tab opened, allow pop-ups and try again. Sending status is available in Gmail.';
    } catch (error) { $('applicationReplyStatus').textContent = error.message; }
  });
  window.KMSApplicationReplies = { open: function (application) {
    if (!application) return;
    retain(); current = application;
    $('applicationReplyApplicant').textContent = (application.name || 'Applicant') + ' · ' + (application.role || 'Job application');
    $('applicationReplyTo').value = application.email || '';
    var draft = drafts.get(application.id);
    $('applicationReplyTemplate').value = draft ? draft.kind : 'received';
    $('applicationReplyTemplate').dataset.previous = $('applicationReplyTemplate').value;
    if (draft) { $('applicationReplySubject').value = draft.subject; $('applicationReplyBody').value = draft.body; dirty = draft.dirty; }
    else populate('received');
    $('applicationReplyStatus').textContent = '';
    dialog.showModal();
  } };
})();
