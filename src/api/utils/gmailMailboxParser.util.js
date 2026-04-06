function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function decodeBodyData(data) {
  if (!data) return '';

  try {
    const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function flattenPayloadText(payload, chunks = []) {
  if (!payload || typeof payload !== 'object') return chunks;

  const mimeType = String(payload.mimeType || '').toLowerCase();
  if ((mimeType.startsWith('text/plain') || mimeType.startsWith('message/delivery-status')) && payload.body?.data) {
    chunks.push(decodeBodyData(payload.body.data));
  }

  if (Array.isArray(payload.parts)) {
    payload.parts.forEach((part) => flattenPayloadText(part, chunks));
  }

  return chunks;
}

function headersToMap(headers = []) {
  const map = {};
  headers.forEach((header) => {
    if (!header?.name) return;
    map[String(header.name).toLowerCase()] = header.value || null;
  });
  return map;
}

function extractEmail(text) {
  if (!text) return null;
  const match = String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function classifyBounce(text, subject) {
  const combined = `${text || ''}\n${subject || ''}`.toLowerCase();

  if (
    combined.includes('daily user sending quota exceeded') ||
    combined.includes('daily sending quota') ||
    combined.includes('quota exceeded') ||
    combined.includes('userratelimitexceeded')
  ) {
    return {
      code: 'EMAIL_PROVIDER_DAILY_LIMIT_REACHED',
      message: 'O Gmail informou que o limite diario de envio foi atingido.',
      permanent: false,
    };
  }

  if (
    combined.includes('address not found') ||
    combined.includes('user unknown') ||
    combined.includes('recipient address rejected') ||
    combined.includes('550 5.1.1') ||
    combined.includes('status: 5.1.1')
  ) {
    return {
      code: 'EMAIL_ADDRESS_NOT_FOUND',
      message: 'O Gmail informou que o endereco do destinatario nao existe.',
      permanent: true,
    };
  }

  if (
    combined.includes('message rejected') ||
    combined.includes('blocked') ||
    combined.includes('policy') ||
    combined.includes('rejected')
  ) {
    return {
      code: 'EMAIL_MESSAGE_REJECTED',
      message: 'O provedor rejeitou a mensagem de e-mail.',
      permanent: true,
    };
  }

  if (
    combined.includes('delivery incomplete') ||
    combined.includes('temporarily deferred') ||
    combined.includes('status: 4.') ||
    combined.includes('temporary')
  ) {
    return {
      code: 'EMAIL_DELIVERY_INCOMPLETE',
      message: 'O provedor informou uma falha temporaria de entrega.',
      permanent: false,
    };
  }

  return {
    code: 'EMAIL_BOUNCE_DETECTED',
    message: 'Foi identificado um retorno de falha de entrega na caixa remetente.',
    permanent: true,
  };
}

function parseBounceMessage(message = {}) {
  const headers = headersToMap(message.payload?.headers || []);
  const subject = normalizeString(headers.subject || message.snippet);
  const from = normalizeString(headers.from);
  const bodyText = flattenPayloadText(message.payload).join('\n');
  const combinedText = `${bodyText}\n${message.snippet || ''}`;
  const lowerCombined = combinedText.toLowerCase();

  const bounceIndicators = [
    from && from.toLowerCase().includes('mailer-daemon'),
    from && from.toLowerCase().includes('mail delivery subsystem'),
    subject && /delivery status notification|undelivered|address not found|delivery incomplete/i.test(subject),
    lowerCombined.includes('final-recipient:'),
    lowerCombined.includes('diagnostic-code:'),
  ];

  const isBounce = bounceIndicators.some(Boolean);
  const originalMessageIdMatch = combinedText.match(/message-id:\s*(<[^>\r\n]+>)/i);
  const finalRecipientMatch = combinedText.match(/final-recipient:\s*rfc822;\s*([^\s\r\n]+)/i);
  const originalRecipientMatch = combinedText.match(/original-recipient:\s*rfc822;\s*([^\s\r\n]+)/i);

  const classification = classifyBounce(combinedText, subject);

  return {
    isBounce,
    subject,
    from,
    internetMessageId: normalizeString(originalMessageIdMatch?.[1]),
    destinationEmail:
      normalizeString(finalRecipientMatch?.[1]) ||
      normalizeString(originalRecipientMatch?.[1]) ||
      extractEmail(headers['x-failed-recipients']) ||
      extractEmail(combinedText),
    classification,
    snippet: normalizeString(message.snippet),
    bodyText: normalizeString(combinedText),
    detectedAt: normalizeString(headers.date) ? new Date(headers.date) : null,
    headers,
  };
}

module.exports = {
  parseBounceMessage,
};
