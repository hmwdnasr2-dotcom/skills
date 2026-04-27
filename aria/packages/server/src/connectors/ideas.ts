import { createClient } from '@supabase/supabase-js';
import type { BridgeAdapter } from '@aria/core';

function db() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

export function buildIdeasAdapters(): BridgeAdapter[] {
  return [
    {
      name: 'save_idea',
      description:
        'Save an idea to the user\'s ideas vault. Call when the user shares an idea, ' +
        'concept, or possibility they want to capture — not a task, just a possibility. ' +
        'Categories: business, technical, personal, creative, general.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:  { type: 'string' },
          title:    { type: 'string', description: 'Short headline for the idea' },
          content:  { type: 'string', description: 'Full idea description, context, or notes' },
          category: {
            type: 'string',
            enum: ['business', 'technical', 'personal', 'creative', 'general'],
            description: 'Default: general',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for later search',
          },
        },
        required: ['user_id', 'title'],
      },
      async call(input) {
        const { user_id, title, content, category = 'general', tags } =
          input as { user_id: string; title: string; content?: string; category?: string; tags?: string[] };

        const { error } = await db().from('aria_ideas').insert({
          user_id,
          title,
          content: content ?? null,
          category,
          tags: tags ?? [],
        });

        if (error) throw new Error(error.message);
        return `Idea saved [${category}]: "${title}"`;
      },
    },

    {
      name: 'list_ideas',
      description:
        'Retrieve ideas from the vault. Call when user asks "what ideas do I have", ' +
        '"show my ideas", "remind me of my business ideas", etc. ' +
        'Optionally filter by category or search text.',
      inputSchema: {
        type: 'object',
        properties: {
          user_id:  { type: 'string' },
          category: {
            type: 'string',
            enum: ['business', 'technical', 'personal', 'creative', 'general', 'all'],
            description: 'Filter by category. Default: all',
          },
          search: { type: 'string', description: 'Optional keyword to filter titles/content' },
          limit:  { type: 'number', description: 'Max ideas to return. Default: 15' },
        },
        required: ['user_id'],
      },
      async call(input) {
        const { user_id, category, search, limit = 15 } =
          input as { user_id: string; category?: string; search?: string; limit?: number };

        let q = db()
          .from('aria_ideas')
          .select('id, title, content, category, tags, created_at')
          .eq('user_id', user_id)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (category && category !== 'all') q = q.eq('category', category);
        if (search) q = q.or(`title.ilike.%${search}%,content.ilike.%${search}%`);

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        if (!data?.length) return 'No ideas found.';

        return data.map((idea) => {
          const date = new Date(idea.created_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short',
          });
          const tags = idea.tags?.length ? ` [${idea.tags.join(', ')}]` : '';
          const preview = idea.content ? ` — ${idea.content.slice(0, 80)}${idea.content.length > 80 ? '…' : ''}` : '';
          return `• [${idea.category}] ${idea.title}${tags}${preview} (${date})`;
        }).join('\n');
      },
    },
  ];
}
