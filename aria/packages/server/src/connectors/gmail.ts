import { google } from 'googleapis';
import type { BridgeAdapter } from '@aria/core';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  body: string;
}

interface ListInput {
  maxResults?: number;
  query?: string;
}

interface SendInput {
  to: string;
  subject: string;
  body: string;
}

interface DraftInput {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  in_reply_to?: string;
}

// ─── OAuth2 client factory ────────────────────────────────────────────────────

function buildAuthClient() {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    throw new Error('Gmail not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to aria/.env then restart the server.');
  }
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI,
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return auth;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeBase64(encoded: string): string {
  return Buffer.from(
    encoded.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString('utf-8');
}

interface MessagePayload {
  body?: { data?: string | null } | null;
  parts?: Array<{ mimeType?: string | null; body?: { data?: string | null } | null }> | null;
}

function extractBody(payload: MessagePayload): string {
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) return decodeBase64(textPart.body.data);
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) return decodeBase64(htmlPart.body.data);
  }
  return '';
}

function buildRfc2822(
  to: string,
  subject: string,
  body: string,
  extra: Record<string, string> = {},
): string {
  const headers = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8'];
  for (const [k, v] of Object.entries(extra)) headers.push(`${k}: ${v}`);
  return [...headers, '', body].join('\r\n');
}

function encodeRaw(raw: string): string {
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── GmailConnector ───────────────────────────────────────────────────────────

export class GmailConnector {
  private get gmail() {
    return google.gmail({ version: 'v1', auth: buildAuthClient() });
  }

  async listMessages(query = 'in:inbox', maxResults = 10): Promise<GmailMessage[]> {
    const listRes = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const ids = listRes.data.messages ?? [];
    return Promise.all(
      ids.map(async ({ id }) => {
        const msg = await this.gmail.users.messages.get({
          userId: 'me',
          id: id!,
          format: 'full',
        });

        const headers = msg.data.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
            ?.value ?? '';

        return {
          id: id!,
          from: get('From'),
          subject: get('Subject'),
          snippet: msg.data.snippet ?? '',
          date: get('Date'),
          body: extractBody(msg.data.payload ?? {}),
        };
      }),
    );
  }

  async getMessage(messageId: string): Promise<GmailMessage> {
    const msg = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = msg.data.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
        ?.value ?? '';

    return {
      id: messageId,
      from: get('From'),
      subject: get('Subject'),
      snippet: msg.data.snippet ?? '',
      date: get('Date'),
      body: extractBody(msg.data.payload ?? {}),
    };
  }

  async sendMessage(to: string, subject: string, body: string): Promise<string> {
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodeRaw(buildRfc2822(to, subject, body)) },
    });
    return res.data.id ?? 'sent';
  }

  async draftMessage(
    to: string,
    subject: string,
    body: string,
    opts: { threadId?: string; inReplyTo?: string } = {},
  ): Promise<string> {
    const extra: Record<string, string> = {};
    if (opts.inReplyTo) {
      extra['In-Reply-To'] = opts.inReplyTo;
      extra['References'] = opts.inReplyTo;
    }

    const requestBody: Record<string, unknown> = {
      raw: encodeRaw(buildRfc2822(to, subject, body, extra)),
    };
    if (opts.threadId) requestBody['threadId'] = opts.threadId;

    const res = await this.gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: requestBody },
    });
    return res.data.id ?? 'draft-created';
  }
}

// ─── Bridge adapters for tool use ─────────────────────────────────────────────

export function buildGmailAdapters(connector: GmailConnector): BridgeAdapter[] {
  return [
    {
      name: 'gmail_list',
      description:
        'List recent emails from Gmail. Returns sender, subject, snippet, and date.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Gmail search query (e.g. "is:unread", "from:boss@example.com"). Defaults to inbox.',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of messages to return (default 10, max 50).',
          },
        },
      },
      async call(input: Record<string, unknown>): Promise<string> {
        const { query = 'in:inbox', maxResults = 10 } = input as ListInput;
        const messages = await connector.listMessages(
          String(query),
          Math.min(Number(maxResults), 50),
        );
        return JSON.stringify(messages, null, 2);
      },
    },

    {
      name: 'gmail_get',
      description: 'Fetch the full body of a Gmail message by ID.',
      inputSchema: {
        type: 'object',
        properties: {
          messageId: {
            type: 'string',
            description: 'Gmail message ID obtained from gmail_list.',
          },
        },
        required: ['messageId'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        const messageId = input['messageId'] as string;
        const message = await connector.getMessage(messageId);
        return JSON.stringify(message, null, 2);
      },
    },

    {
      name: 'gmail_send',
      description: 'Send an email via Gmail. Only use when the user explicitly says to send.',
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
        const id = await connector.sendMessage(
          input['to'] as string,
          input['subject'] as string,
          input['body'] as string,
        );
        return `Email sent. Message ID: ${id}`;
      },
    },

    {
      name: 'gmail_draft',
      description:
        'Save a draft reply or new email in Gmail WITHOUT sending it. ' +
        'Use when the user says "draft a reply", "compose but don\'t send", or "prepare a response".',
      inputSchema: {
        type: 'object',
        properties: {
          to:         { type: 'string', description: 'Recipient email address.' },
          subject:    { type: 'string', description: 'Email subject.' },
          body:       { type: 'string', description: 'Plain-text email body.' },
          thread_id:  { type: 'string', description: 'Thread ID from gmail_list (for replies).' },
          in_reply_to: { type: 'string', description: 'Message-ID header of the email being replied to.' },
        },
        required: ['to', 'subject', 'body'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        const { to, subject, body, thread_id, in_reply_to } = input as unknown as DraftInput;
        const id = await connector.draftMessage(to, subject, body, {
          threadId: thread_id,
          inReplyTo: in_reply_to,
        });
        return `Draft saved (ID: ${id}). Open Gmail to review and send.`;
      },
    },
  ];
}
