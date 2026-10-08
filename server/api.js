import { Router } from 'express';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

export const apiRouter = Router();

// Rate limiter: 60 requests/min per IP
const ipRateLimits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipRateLimits.entries()) {
    if (now - data.resetTime > 60000) {
      ipRateLimits.delete(ip);
    }
  }
}, 30000);

const checkRateLimit = (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const now = Date.now();
  let record = ipRateLimits.get(ip);
  if (!record || now - record.resetTime > 60000) {
    record = { count: 0, resetTime: now };
    ipRateLimits.set(ip, record);
  }
  record.count += 1;
  if (record.count > 60) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' } });
  }
  next();
};

apiRouter.use(checkRateLimit);

// 1. Health check
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// 2. Proxy endpoint
const ALLOWED_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'api.tavily.com',
]);

const ALLOWED_FORWARD_HEADERS = [
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
  'content-type',
];

const handleProxy = async (req, res) => {
  const targetUrlStr = req.headers['x-target-url'];
  if (!targetUrlStr || typeof targetUrlStr !== 'string') {
    return res.status(400).json({ error: 'Missing x-target-url header' });
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch {
    return res.status(400).json({ error: 'Invalid target URL' });
  }

  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return res.status(403).json({ error: `Host '${targetUrl.hostname}' is not allowed` });
  }

  const forwardHeaders = {};
  for (const key of ALLOWED_FORWARD_HEADERS) {
    if (req.headers[key]) {
      forwardHeaders[key] = req.headers[key];
    }
  }

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  try {
    const fetchInit = {
      method: req.method,
      headers: forwardHeaders,
      signal: abortController.signal,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body !== undefined && req.body !== null) {
        fetchInit.body = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body);
      }
    }

    const upstreamRes = await fetch(targetUrl.href, fetchInit);
    res.status(upstreamRes.status);

    for (const [key, value] of upstreamRes.headers.entries()) {
      const lower = key.toLowerCase();
      if (['content-type', 'cache-control', 'content-length'].includes(lower)) {
        res.setHeader(key, value);
      }
    }

    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } else {
      res.end();
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to reach upstream provider' });
    }
  }
};

apiRouter.all('/proxy', handleProxy);

// 3. Mail endpoints (IMAP via imapflow)
const runWithImap = async (email, appPassword, action) => {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const normalizedPass = (appPassword || '').replace(/\s+/g, '');

  if (!normalizedEmail || !normalizedPass) {
    const err = new Error('Gmail address and App Password are required.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: normalizedEmail,
      pass: normalizedPass,
    },
    logger: false,
  });

  client.on('error', () => {});

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error('Gmail took too long to respond. Try again.');
      err.code = 'TIMEOUT';
      reject(err);
    }, 20000);
  });

  try {
    await Promise.race([client.connect(), timeoutPromise]);
    const result = await Promise.race([action(client, normalizedEmail), timeoutPromise]);
    return result;
  } catch (error) {
    const errMsg = String(error?.message || '').toLowerCase();
    if (error.code === 'BAD_REQUEST') {
      throw error;
    }
    if (error.code === 'TIMEOUT' || errMsg.includes('timeout')) {
      const err = new Error('Gmail took too long to respond. Try again.');
      err.code = 'TIMEOUT';
      throw err;
    }
    if (
      errMsg.includes('authenticationfailed') ||
      errMsg.includes('invalid credentials') ||
      errMsg.includes('auth') ||
      errMsg.includes('login')
    ) {
      const err = new Error(
        'Gmail rejected the login. Use the 16-character App Password (not your normal password) and check the address.'
      );
      err.code = 'AUTH_FAILED';
      throw err;
    }
    const err = new Error("Couldn't reach Gmail. Try again in a moment.");
    err.code = 'IMAP_ERROR';
    throw err;
  } finally {
    clearTimeout(timeoutId);
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {}
    }
  }
};

// Mail list
apiRouter.post('/mail/list', async (req, res) => {
  const { email, appPassword, query, limit = 15 } = req.body || {};
  try {
    const messages = await runWithImap(email, appPassword, async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const fetchLimit = Math.min(Math.max(parseInt(limit, 10) || 15, 1), 30);
        let uidsToFetch = [];

        if (query && typeof query === 'string' && query.trim().length > 0) {
          const searchUids = await client.search({ text: query.trim() }, { uid: true });
          if (Array.isArray(searchUids) && searchUids.length > 0) {
            uidsToFetch = searchUids.slice(-fetchLimit);
          }
        } else {
          const status = await client.status('INBOX', { messages: true });
          const total = status.messages || 0;
          if (total > 0) {
            const startSeq = Math.max(1, total - fetchLimit + 1);
            const range = `${startSeq}:*`;
            const seqMessages = [];
            for await (const msg of client.fetch(range, { uid: true, envelope: true, internalDate: true, flags: true })) {
              seqMessages.push(msg);
            }
            return seqMessages
              .map((msg) => ({
                uid: msg.uid,
                from: msg.envelope?.from?.[0]?.name
                  ? `${msg.envelope.from[0].name} <${msg.envelope.from[0].address || ''}>`
                  : msg.envelope?.from?.[0]?.address || 'Unknown',
                subject: msg.envelope?.subject || '(No Subject)',
                date: msg.internalDate ? new Date(msg.internalDate).toISOString() : new Date().toISOString(),
                unread: !msg.flags?.has('\\Seen'),
              }))
              .reverse();
          }
          return [];
        }

        if (uidsToFetch.length === 0) {
          return [];
        }

        const msgList = [];
        for await (const msg of client.fetch(uidsToFetch, { uid: true, envelope: true, internalDate: true, flags: true }, { uid: true })) {
          msgList.push(msg);
        }

        return msgList
          .map((msg) => ({
            uid: msg.uid,
            from: msg.envelope?.from?.[0]?.name
              ? `${msg.envelope.from[0].name} <${msg.envelope.from[0].address || ''}>`
              : msg.envelope?.from?.[0]?.address || 'Unknown',
            subject: msg.envelope?.subject || '(No Subject)',
            date: msg.internalDate ? new Date(msg.internalDate).toISOString() : new Date().toISOString(),
            unread: !msg.flags?.has('\\Seen'),
          }))
          .reverse();
      } finally {
        lock.release();
      }
    });

    res.json({ messages });
  } catch (err) {
    const code = err.code || 'IMAP_ERROR';
    const status = code === 'BAD_REQUEST' ? 400 : code === 'AUTH_FAILED' ? 401 : code === 'TIMEOUT' ? 504 : 500;
    res.status(status).json({ error: { code, message: err.message } });
  }
});

// Mail get
apiRouter.post('/mail/get', async (req, res) => {
  const { email, appPassword, uid } = req.body || {};
  if (!uid) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Message UID is required.' } });
  }

  try {
    const emailData = await runWithImap(email, appPassword, async (client) => {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const message = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!message || !message.source) {
          throw new Error('Message not found.');
        }

        const parsed = await simpleParser(message.source);
        let plainText = parsed.text || '';
        if (!plainText && parsed.html) {
          plainText = parsed.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        if (plainText.length > 20000) {
          plainText = plainText.substring(0, 20000);
        }

        const fromText = parsed.from?.text || (parsed.from?.value?.[0]?.address ? `<${parsed.from.value[0].address}>` : 'Unknown');
        const replyToText = parsed.replyTo?.text || (parsed.replyTo?.value?.[0]?.address ? `<${parsed.replyTo.value[0].address}>` : undefined);

        return {
          from: fromText,
          replyTo: replyToText,
          subject: parsed.subject || '(No Subject)',
          date: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
          messageId: parsed.messageId,
          references: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references,
          text: plainText,
        };
      } finally {
        lock.release();
      }
    });

    res.json(emailData);
  } catch (err) {
    const code = err.code || 'IMAP_ERROR';
    const status = code === 'BAD_REQUEST' ? 400 : code === 'AUTH_FAILED' ? 401 : code === 'TIMEOUT' ? 504 : 500;
    res.status(status).json({ error: { code, message: err.message } });
  }
});

// Mail draft
apiRouter.post('/mail/draft', async (req, res) => {
  const { email, appPassword, to, subject, body, inReplyTo, references } = req.body || {};
  if (!to || !body) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Recipient and draft body are required.' } });
  }

  try {
    await runWithImap(email, appPassword, async (client, userEmail) => {
      let draftSubject = subject || '';
      if (draftSubject && !draftSubject.toLowerCase().startsWith('re:')) {
        draftSubject = `Re: ${draftSubject}`;
      }

      const mail = new MailComposer({
        from: userEmail,
        to,
        subject: draftSubject,
        text: body,
        inReplyTo,
        references,
      });

      const rawMessage = await mail.compile().build();

      const mailboxes = await client.list();
      let draftsPath = '[Gmail]/Drafts';
      for (const box of mailboxes) {
        if (box.specialUse === '\\Drafts') {
          draftsPath = box.path;
          break;
        }
      }

      await client.append(draftsPath, rawMessage, ['\\Draft']);
      return { ok: true };
    });

    res.json({ ok: true });
  } catch (err) {
    const code = err.code || 'IMAP_ERROR';
    const status = code === 'BAD_REQUEST' ? 400 : code === 'AUTH_FAILED' ? 401 : code === 'TIMEOUT' ? 504 : 500;
    res.status(status).json({ error: { code, message: err.message } });
  }
});
