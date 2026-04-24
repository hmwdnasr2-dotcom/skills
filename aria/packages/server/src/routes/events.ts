import { Router } from 'express';
import { registerSseClient } from '../proactive/push.js';

export const eventsRouter = Router();

eventsRouter.get('/', (req, res) => {
  const userId = req.query.userId as string | undefined;
  if (!userId) {
    res.status(400).json({ error: 'userId query param required' });
    return;
  }
  registerSseClient(userId, res);
});
