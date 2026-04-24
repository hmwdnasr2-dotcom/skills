import type { BridgeAdapter } from '../connector.js';

export class PerplexityAdapter implements BridgeAdapter {
  name = 'web_search';
  description = 'Search the web for current information. Returns a cited summary.';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  };

  async call({ query }: { query: string }): Promise<string> {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
      }),
    });

    if (!res.ok) throw new Error(`Perplexity API error: ${res.status}`);

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0].message.content;
  }
}
