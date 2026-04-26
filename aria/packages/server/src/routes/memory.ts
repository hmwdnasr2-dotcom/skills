import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

export const memoryRouter = Router();

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

// GET /api/aria/memory?userId=...
memoryRouter.get('/', async (req, res) => {
  const userId = req.query.userId as string | undefined;
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }

  const { data, error } = await db()
    .from('aria_memory')
    .select('id, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ memories: data ?? [] });
});

// DELETE /api/aria/memory/:id
memoryRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await db().from('aria_memory').delete().eq('id', id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});
