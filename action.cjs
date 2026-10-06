'use strict';

// Auth0 custom-email-provider v1. No message contents or credentials are logged.
exports.onExecuteCustomEmailProvider = async (event, api) => {
  const fail = (reason) => api.notification.drop(reason);
  const mailbox = (value) => {
    // Auth0 documents these fields as email addresses. Display names/lists are
    // deliberately rejected, rather than guessing and sending to another user.
    if (typeof value !== 'string' || value.length > 254 ||
        !/^[^\s<>(),;:"\\@]+@[^\s<>(),;:"\\@]+\.[^\s<>(),;:"\\@]+$/u.test(value)) {
      throw new Error('invalid mailbox');
    }
    return { email: value };
  };
  let body;
  let key;
  try {
    key = event.secrets.MAILCHANNELS_API_KEY;
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new Error('key');
    const n = event.notification;
    if (typeof n.subject !== 'string' || /[\r\n]/.test(n.subject)) throw new Error('subject');
    const content = [];
    for (const [field, type] of [['text', 'text/plain'], ['html', 'text/html']]) {
      if (n[field] !== undefined && n[field] !== null && typeof n[field] !== 'string') throw new Error('content');
      if (n[field]) content.push({ type, value: n[field] });
    }
    if (!content.length) throw new Error('content');
    body = JSON.stringify({
      personalizations: [{ to: [mailbox(n.to)] }],
      from: mailbox(n.from), subject: n.subject, content,
    });
  } catch {
    fail('MailChannels: invalid notification or missing configuration.');
    return;
  }

  // Do not request Auth0 retries: ambiguous acceptance could duplicate a security
  // notification. drop() records a failure for operator investigation.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key }, body,
    });
    // /send documents 202 acceptance. Do not consume provider bodies, which can
    // contain recipient/message details. Acceptance does not mean inbox delivery.
    if (response.body) await response.body.cancel();
    if (response.status !== 202) fail(`MailChannels: request not accepted (HTTP ${response.status}); automatic retry disabled.`);
  } catch {
    fail('MailChannels: request outcome uncertain; automatic retry disabled. Check delivery records before resending.');
  } finally {
    clearTimeout(timeout);
  }
};
