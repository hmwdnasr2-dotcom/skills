import nodemailer from 'nodemailer';
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

// ─── SMTP transport (App Password) ────────────────────────────────────────────

function getCredentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'Gmail not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to aria/.env. ' +
      'Get an App Password at myaccount.google.com/security → App passwords.',
    );
  }
  return { user, pass };
}

function buildTransport() {
  const { user, pass } = getCredentials();
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // STARTTLS
    auth: { type: 'login', user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
}

// ─── GmailConnector ───────────────────────────────────────────────────────────

export class GmailConnector {
  async sendMessage(to: string, subject: string, body: string): Promise<string> {
    const { user } = getCredentials();
    const transport = buildTransport();
    const info = await transport.sendMail({ from: user, to, subject, text: body });
    return info.messageId ?? 'sent';
  }
}

// ─── Bridge adapters ──────────────────────────────────────────────────────────

export function buildGmailAdapters(connector: GmailConnector): BridgeAdapter[] {
  return [
    {
      name: 'gmail_send',
      description:
        'Send an email via Gmail. Only use when the user explicitly says to send. ' +
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
        const id = await connector.sendMessage(
          input['to'] as string,
          input['subject'] as string,
          input['body'] as string,
        );
        return `Email sent successfully. Message ID: ${id}`;
      },
    },
  ];
}
