/**
 * Client-side RFC822 / EML parser.
 * Extracts From, Subject, Date, and body (plain text or html converted to text).
 * Handles quoted-printable, base64, and RFC2047 headers.
 */

function decodeRfc2047(str: string): string {
  return str.replace(/=\?([\w-]+)\?([bqBQ])\?([^?]+)\?=/g, (_, _charset, encoding, encodedText) => {
    try {
      const isBase64 = encoding.toUpperCase() === 'B';
      if (isBase64) {
        const decoded = atob(encodedText);
        // UTF-8 decode
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      } else {
        // Quoted-Printable in header: replace _ with space, and =XX with byte
        const replaced = encodedText.replace(/_/g, ' ');
        return decodeQuotedPrintable(replaced);
      }
    } catch {
      return encodedText;
    }
  });
}

function decodeQuotedPrintable(input: string): string {
  // Soft line breaks
  const unified = input.replace(/=\r?\n/g, '');
  // Match =XX
  const bytes: number[] = [];
  let i = 0;
  while (i < unified.length) {
    if (unified[i] === '=' && i + 2 < unified.length) {
      const hex = unified.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(unified.charCodeAt(i));
    i++;
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function decodeBase64(input: string): string {
  const clean = input.replace(/\s+/g, '');
  const raw = atob(clean);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export interface ParsedEml {
  from?: string;
  subject?: string;
  date?: string;
  body: string;
}

export function parseEmlText(rawEml: string): ParsedEml {
  try {
    const headerBodySplit = rawEml.split(/\r?\n\r?\n/);
    if (headerBodySplit.length < 2) {
      return { body: rawEml };
    }

    const headerBlock = headerBodySplit[0];
    const bodyBlock = headerBodySplit.slice(1).join('\n\n');

    // Parse headers (handling folded header lines starting with space or tab)
    const rawHeaderLines = headerBlock.split(/\r?\n/);
    const headers: Record<string, string> = {};
    let currentKey = '';

    for (const line of rawHeaderLines) {
      if (/^[ \t]/.test(line) && currentKey) {
        headers[currentKey] += ' ' + line.trim();
      } else {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          currentKey = line.substring(0, colonIdx).trim().toLowerCase();
          headers[currentKey] = line.substring(colonIdx + 1).trim();
        }
      }
    }

    const from = headers['from'] ? decodeRfc2047(headers['from']) : undefined;
    const subject = headers['subject'] ? decodeRfc2047(headers['subject']) : undefined;
    const date = headers['date'] ? decodeRfc2047(headers['date']) : undefined;
    const contentType = headers['content-type'] || 'text/plain';
    const contentTransferEncoding = (headers['content-transfer-encoding'] || '').toLowerCase();

    // Check for multipart
    const boundaryMatch = contentType.match(/boundary=["']?([^"';]+)["']?/i);
    let extractedBody = '';

    if (boundaryMatch) {
      const boundary = boundaryMatch[1];
      const parts = bodyBlock.split(new RegExp(`--${boundary}(?:--)?`));

      let plainPart = '';
      let htmlPart = '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const subSplit = trimmed.split(/\r?\n\r?\n/);
        if (subSplit.length < 2) continue;

        const subHeadersRaw = subSplit[0].toLowerCase();
        const subBody = subSplit.slice(1).join('\n\n');

        let partEncoding = '';
        if (subHeadersRaw.includes('content-transfer-encoding: base64')) {
          partEncoding = 'base64';
        } else if (subHeadersRaw.includes('content-transfer-encoding: quoted-printable')) {
          partEncoding = 'quoted-printable';
        }

        let decodedPart = subBody;
        if (partEncoding === 'base64') {
          try {
            decodedPart = decodeBase64(subBody);
          } catch {}
        } else if (partEncoding === 'quoted-printable') {
          try {
            decodedPart = decodeQuotedPrintable(subBody);
          } catch {}
        }

        if (subHeadersRaw.includes('text/plain')) {
          plainPart = decodedPart;
          break; // First text/plain wins
        } else if (subHeadersRaw.includes('text/html') && !htmlPart) {
          htmlPart = decodedPart;
        }
      }

      if (plainPart) {
        extractedBody = plainPart;
      } else if (htmlPart) {
        extractedBody = htmlPart.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      } else {
        extractedBody = bodyBlock;
      }
    } else {
      // Single part
      let decoded = bodyBlock;
      if (contentTransferEncoding.includes('base64')) {
        try {
          decoded = decodeBase64(bodyBlock);
        } catch {}
      } else if (contentTransferEncoding.includes('quoted-printable')) {
        try {
          decoded = decodeQuotedPrintable(bodyBlock);
        } catch {}
      }

      if (contentType.toLowerCase().includes('text/html')) {
        extractedBody = decoded.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      } else {
        extractedBody = decoded;
      }
    }

    return {
      from,
      subject,
      date,
      body: extractedBody.trim() || rawEml,
    };
  } catch {
    return { body: rawEml };
  }
}
