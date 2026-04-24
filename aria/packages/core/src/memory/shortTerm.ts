import type { SupabaseClient } from '@supabase/supabase-js';
import type { Message } from '../brain/adapter.js';

export class ShortTermMemory {
  private supabase: SupabaseClient;
  private maxRows: number;

  constructor({ supabase, maxRows = 50 }: { supabase: SupabaseClient; maxRows?: number }) {
    this.supabase = supabase;
    this.maxRows = maxRows;
  }

  async load(userId: string): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from('aria_short_term_memory')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(this.maxRows);

    if (error) throw error;
    return ((data ?? []).reverse()) as Message[];
  }

  async save(userId: string, messages: Message[], assistantReply: string) {
    const rows = [
      ...messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ user_id: userId, role: m.role, content: m.content })),
      { user_id: userId, role: 'assistant', content: assistantReply },
    ];

    const { error } = await this.supabase
      .from('aria_short_term_memory')
      .insert(rows);

    if (error) throw error;
    await this.trim(userId);
  }

  private async trim(userId: string) {
    const { data } = await this.supabase
      .from('aria_short_term_memory')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!data || data.length <= this.maxRows) return;

    const toDelete = data.slice(this.maxRows).map((r) => r.id);
    await this.supabase.from('aria_short_term_memory').delete().in('id', toDelete);
  }
}
