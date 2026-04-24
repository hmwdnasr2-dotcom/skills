import type { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export class LongTermMemory {
  private openai: OpenAI;
  private supabase: SupabaseClient;
  private embeddingModel: string;

  constructor({
    supabase,
    embeddingModel = 'text-embedding-3-small',
  }: {
    supabase: SupabaseClient;
    embeddingModel?: string;
  }) {
    this.openai = new OpenAI();
    this.supabase = supabase;
    this.embeddingModel = embeddingModel;
  }

  async upsert(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ) {
    const embedding = await this.embed(content);

    const { error } = await this.supabase.from('aria_long_term_memory').insert({
      user_id: userId,
      content,
      embedding,
      metadata,
    });

    if (error) throw error;
  }

  async search(
    userId: string,
    query: string,
    topK = 5,
  ): Promise<Array<{ content: string; similarity: number }>> {
    const embedding = await this.embed(query);

    const { data, error } = await this.supabase.rpc('aria_match_memories', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: topK,
    });

    if (error) throw error;
    return (data ?? []) as Array<{ content: string; similarity: number }>;
  }

  private async embed(text: string): Promise<number[]> {
    const res = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    return res.data[0].embedding;
  }
}
