import type { Response } from 'express';

const clients = new Map<string, Response>();

export function registerSseClient(userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Keep-alive ping every 30 s
  const ping = setInterval(() => res.write(': ping\n\n'), 30_000);

  clients.set(userId, res);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(userId);
  });
}

export async function pushToCommandLog(userId: string, content: string, type: 'message' | 'notification' = 'message') {
  const res = clients.get(userId);
  if (res) {
    res.write(`data: ${JSON.stringify({ content, type })}\n\n`);
  }
}

// Push a notification to all connected users (for system-level events)
export async function broadcastNotification(content: string): Promise<void> {
  for (const [, res] of clients) {
    res.write(`data: ${JSON.stringify({ content, type: 'notification' })}\n\n`);
  }
}

export function connectedUserIds(): string[] {
  return Array.from(clients.keys());
}
