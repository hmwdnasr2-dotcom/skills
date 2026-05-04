import { ImapFlow } from 'imapflow';

export interface EmailMessage {
  uid: number;
  from: string;
  subject: string;
  date: Date;
  snippet: string;
}

function getImapCredentials() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass };
}

export function imapEnabled(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

async function openClient() {
  const creds = getImapCredentials();
  if (!creds) return null;
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: creds,
    logger: false,
  });
  await client.connect();
  return client;
}

/**
 * Returns the highest UID currently in INBOX.
 * Called on first boot so we start watching from NOW, not from the beginning of history.
 */
export async function getCurrentMaxUid(): Promise<number> {
  const client = await openClient();
  if (!client) return 0;
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { uidNext: true });
      // uidNext is the UID that will be assigned to the NEXT incoming message,
      // so the last existing message has UID = uidNext - 1.
      return Math.max(0, (status.uidNext ?? 1) - 1);
    } finally {
      lock.release();
    }
  } catch {
    return 0;
  } finally {
    await client.logout();
  }
}

/**
 * Fetches emails with UID > sinceUid (i.e. arrived after last check).
 * Uses UID-mode fetch so sinceUid tracking is reliable across sessions.
 */
export async function fetchNewEmails(sinceUid: number): Promise<{ emails: EmailMessage[]; maxUid: number }> {
  const client = await openClient();
  if (!client) return { emails: [], maxUid: sinceUid };

  const emails: EmailMessage[] = [];
  let maxUid = sinceUid;

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // UID range: (sinceUid+1):* — only messages newer than last seen
      const range = `${sinceUid + 1}:*`;
      const messages = client.fetch(range, { uid: true, envelope: true }, { uid: true });

      for await (const msg of messages) {
        if (!msg.uid || msg.uid <= sinceUid) continue;
        const from = msg.envelope?.from?.[0];
        const fromStr = from
          ? (from.name ? `${from.name} <${from.address}>` : (from.address ?? ''))
          : '';
        emails.push({
          uid:     msg.uid,
          from:    fromStr,
          subject: msg.envelope?.subject ?? '(no subject)',
          date:    msg.envelope?.date ?? new Date(),
          snippet: '',
        });
        if (msg.uid > maxUid) maxUid = msg.uid;
      }
    } finally {
      lock.release();
    }
  } catch {
    // Empty mailbox or no messages in range — normal
  } finally {
    await client.logout();
  }

  return { emails, maxUid };
}
