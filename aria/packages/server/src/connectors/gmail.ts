import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { BridgeAdapter } from '@aria/core';

// ─── Credentials ──────────────────────────────────────────────────────────────

function getCredentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'Gmail not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to aria/.env.',
    );
  }
  return { user, pass };
}

function buildSmtpTransport() {
  const { user, pass } = getCredentials();
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { type: 'login', user, pass },
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     10_000,
  });
}

async function openImap() {
  const { user, pass } = getCredentials();
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  return client;
}

// ─── GmailConnector ───────────────────────────────────────────────────────────

export class GmailConnector {
  async sendMessage(to: string, subject: string, body: string): Promise<string> {
    const { user } = getCredentials();
    const info = await buildSmtpTransport().sendMail({ from: user, to, subject, text: body });
    return info.messageId ?? 'sent';
  }

  async listEmails(maxResults = 10, query = 'is:unread'): Promise<string> {
    const client = await openImap();
    const results: string[] = [];
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // Map Gmail-style queries to IMAP search criteria
        const criteria: Record<string, unknown> = {};
        if (query.includes('is:unread'))       criteria['seen'] = false;
        if (query.includes('is:read'))         criteria['seen'] = true;
        if (query.includes('is:starred'))      criteria['flagged'] = true;
        const fromMatch = query.match(/from:(\S+)/);
        if (fromMatch)                         criteria['from'] = fromMatch[1];
        const subjMatch = query.match(/subject:(.+?)(?:\s+\w+:|$)/);
        if (subjMatch)                         criteria['subject'] = subjMatch[1].trim();

        const uids = await client.search(Object.keys(criteria).length ? criteria : { all: true }, { uid: true });
        const uidList = Array.isArray(uids) ? uids : [];
        const recent = uidList.slice(-maxResults);

        if (!recent.length) return 'No emails found matching that query.';

        const uidRange = recent.join(',');
        const messages = client.fetch(uidRange, { uid: true, envelope: true }, { uid: true });

        for await (const msg of messages) {
          const from  = msg.envelope?.from?.[0];
          const fromStr = from?.name ? `${from.name} <${from.address}>` : (from?.address ?? '');
          const date  = msg.envelope?.date?.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? '';
          results.push(`[UID:${msg.uid}] ${date} | From: ${fromStr} | Subject: ${msg.envelope?.subject ?? '(no subject)'}`);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    return results.reverse().join('\n');
  }

  async getEmail(uid: number): Promise<string> {
    const client = await openImap();
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true, source: true }, { uid: true });
        if (!msg) return `Email UID ${uid} not found.`;

        const from    = msg.envelope?.from?.[0];
        const fromStr = from?.name ? `${from.name} <${from.address}>` : (from?.address ?? '');
        const date    = msg.envelope?.date?.toLocaleString('en-GB') ?? '';

        // Decode the raw source to extract readable text
        let body = '';
        if (msg.source) {
          const raw    = msg.source.toString();
          const parts  = raw.split(/\r?\n\r?\n/);
          body = parts.slice(1).join('\n\n').replace(/<[^>]+>/g, '').replace(/=\r?\n/g, '').trim().slice(0, 3000);
        }
        return `From: ${fromStr}\nDate: ${date}\nSubject: ${msg.envelope?.subject ?? ''}\n\n${body || '(empty body)'}`;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }

  async replyToEmail(uid: number, replyBody: string): Promise<string> {
    const { user } = getCredentials();
    const client = await openImap();
    let to = '', subject = '', messageId = '';

    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const msg = await client.fetchOne(String(uid), { uid: true, envelope: true }, { uid: true });
        if (!msg) throw new Error(`Email UID ${uid} not found`);
        const replyTo = msg.envelope?.replyTo?.[0] ?? msg.envelope?.from?.[0];
        to        = replyTo?.address ?? '';
        subject   = `Re: ${msg.envelope?.subject ?? ''}`;
        messageId = msg.envelope?.messageId ?? '';
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    if (!to) throw new Error('Could not determine reply-to address');

    const info = await buildSmtpTransport().sendMail({
      from:       user,
      to,
      subject,
      text:       replyBody,
      inReplyTo:  messageId,
      references: messageId,
    });
    return `Reply sent to ${to}. Message ID: ${info.messageId ?? 'sent'}`;
  }
}

// ─── Bridge adapters ──────────────────────────────────────────────────────────

export function buildGmailAdapters(connector: GmailConnector): BridgeAdapter[] {
  return [
    {
      name: 'gmail_send',
      description:
        'Send a new email via Gmail. Only use when the user explicitly asks to send. ' +
        'Always confirm recipient, subject, and body before calling.',
      inputSchema: {
        type: 'object',
        properties: {
          to:      { type: 'string', description: 'Recipient email address.' },
          subject: { type: 'string', description: 'Email subject line.' },
          body:    { type: 'string', description: 'Plain-text email body.' },
        },
        required: ['to', 'subject', 'body'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        return connector.sendMessage(input['to'] as string, input['subject'] as string, input['body'] as string);
      },
    },

    {
      name: 'gmail_list',
      description:
        'List emails from the Gmail inbox. Use to check unread messages, search by sender, ' +
        'or browse recent mail. Returns a numbered list with UID, date, sender, and subject. ' +
        'The UID can be passed to gmail_get or gmail_reply.',
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Max emails to return. Default 10.' },
          query: {
            type: 'string',
            description: 'Gmail-style search: "is:unread", "is:read", "from:boss@co.com", "subject:invoice". Default "is:unread".',
          },
        },
      },
      async call(input: Record<string, unknown>): Promise<string> {
        return connector.listEmails(
          (input['maxResults'] as number | undefined) ?? 10,
          (input['query'] as string | undefined) ?? 'is:unread',
        );
      },
    },

    {
      name: 'gmail_get',
      description:
        'Read the full content of a specific email by its UID. ' +
        'Get the UID from gmail_list first. Returns sender, date, subject, and body text.',
      inputSchema: {
        type: 'object',
        properties: {
          uid: { type: 'number', description: 'The email UID from gmail_list.' },
        },
        required: ['uid'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        return connector.getEmail(input['uid'] as number);
      },
    },

    {
      name: 'gmail_reply',
      description:
        'Reply to an email by its UID. Automatically sets the correct subject (Re: …) and ' +
        'In-Reply-To headers. Get the UID from gmail_list. Confirm the reply text with the user first.',
      inputSchema: {
        type: 'object',
        properties: {
          uid:  { type: 'number', description: 'UID of the email to reply to (from gmail_list).' },
          body: { type: 'string', description: 'Plain-text reply body.' },
        },
        required: ['uid', 'body'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        return connector.replyToEmail(input['uid'] as number, input['body'] as string);
      },
    },
  ];
}
