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

interface GetInput {
  messageId: string;
}

// ─── OAuth2 client factory ────────────────────────────────────────────────────

function buildAuthClient() {
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

function buildRfc2822(to: string, subject: string, body: string): string {
  return [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

// ─── GmailConnector ───────────────────────────────────────────────────────────

export class GmailConnector {
  private gmail = google.gmail({ version: 'v1', auth: buildAuthClient() });

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
    const raw = Buffer.from(buildRfc2822(to, subject, body))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return res.data.id ?? 'sent';
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
      description: 'Send an email via Gmail.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address.' },
          subject: { type: 'string', description: 'Email subject line.' },
          body: { type: 'string', description: 'Plain-text email body.' },
        },
        required: ['to', 'subject', 'body'],
      },
      async call(input: Record<string, unknown>): Promise<string> {
        const to = input['to'] as string;
        const subject = input['subject'] as string;
        const body = input['body'] as string;
        const id = await connector.sendMessage(to, subject, body);
        return `Email sent. Message ID: ${id}`;
      },
    },
  ];
}
