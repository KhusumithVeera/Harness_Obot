/**
 * Client-side Google Gmail REST API integration.
 * Connects directly using Google OAuth Access Token.
 */

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
}

export interface GmailMessageFull {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  date: string;
  snippet: string;
  text: string;
  messageId?: string;
  references?: string;
}

function decodeBase64Url(base64UrlStr: string): string {
  try {
    let base64 = base64UrlStr.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function extractBodyFromPayload(payload: any): string {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data && (!payload.mimeType || payload.mimeType === 'text/plain')) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart
  if (Array.isArray(payload.parts)) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Fall back to text/html stripped of tags
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    // Recursive search
    for (const part of payload.parts) {
      const nested = extractBodyFromPayload(part);
      if (nested) return nested;
    }
  }

  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data);
    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return '';
}

export async function listGmailMessages(
  token: string,
  query: string = '',
  maxResults: number = 15
): Promise<GmailMessageSummary[]> {
  const qParam = query.trim() || 'label:INBOX';
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(
    qParam
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Google authentication expired. Please sign in again.');
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gmail API error: ${res.status}`);
  }

  const data = await res.json();
  const rawList: { id: string; threadId: string }[] = data.messages || [];

  if (rawList.length === 0) return [];

  // Fetch metadata for each message
  const details = await Promise.all(
    rawList.slice(0, maxResults).map(async (item) => {
      try {
        const metaRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (!metaRes.ok) return null;
        const meta = await metaRes.json();

        let from = 'Unknown';
        let subject = '(No Subject)';
        let date = new Date().toISOString();

        for (const h of meta.payload?.headers || []) {
          if (h.name?.toLowerCase() === 'from') from = h.value;
          if (h.name?.toLowerCase() === 'subject') subject = h.value;
          if (h.name?.toLowerCase() === 'date') date = h.value;
        }

        const unread = Array.isArray(meta.labelIds) && meta.labelIds.includes('UNREAD');

        return {
          id: item.id,
          threadId: item.threadId,
          from,
          subject,
          date,
          snippet: meta.snippet || '',
          unread,
        };
      } catch {
        return null;
      }
    })
  );

  return details.filter((d): d is GmailMessageSummary => d !== null);
}

export async function getGmailMessage(
  token: string,
  messageId: string
): Promise<GmailMessageFull> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch message ${messageId}`);
  }

  const data = await res.json();

  let from = 'Unknown';
  let to = '';
  let subject = '(No Subject)';
  let date = new Date().toISOString();
  let messageIdHeader: string | undefined;
  let references: string | undefined;

  for (const h of data.payload?.headers || []) {
    const name = h.name?.toLowerCase();
    if (name === 'from') from = h.value;
    if (name === 'to') to = h.value;
    if (name === 'subject') subject = h.value;
    if (name === 'date') date = h.value;
    if (name === 'message-id') messageIdHeader = h.value;
    if (name === 'references') references = h.value;
  }

  let text = extractBodyFromPayload(data.payload) || data.snippet || '';
  if (text.length > 20000) {
    text = text.substring(0, 20000);
  }

  return {
    id: data.id,
    threadId: data.threadId,
    from,
    to,
    subject,
    date,
    snippet: data.snippet || '',
    text,
    messageId: messageIdHeader,
    references,
  };
}

export async function createGmailDraft(
  token: string,
  params: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string;
    references?: string;
    threadId?: string;
  }
): Promise<{ id: string }> {
  let draftSubject = params.subject || '';
  if (draftSubject && !draftSubject.toLowerCase().startsWith('re:')) {
    draftSubject = `Re: ${draftSubject}`;
  }

  const lines = [
    `To: ${params.to}`,
    `Subject: ${draftSubject}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
  ];

  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }
  if (params.references) {
    lines.push(`References: ${params.references}`);
  }

  lines.push('', params.body);

  const rawRfc822 = lines.join('\r\n');
  // Base64Url encode UTF-8
  const utf8Bytes = new TextEncoder().encode(rawRfc822);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const base64Url = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const payload: any = {
    message: {
      raw: base64Url,
      threadId: params.threadId,
    },
  };

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to create Gmail draft');
  }

  return await res.json();
}
