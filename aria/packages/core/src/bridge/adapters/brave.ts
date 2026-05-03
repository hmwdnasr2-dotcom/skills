import type { BridgeAdapter } from '../connector.js';

interface BraveWebResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
  news?: {
    results?: Array<{ title: string; url: string; description?: string; age?: string }>;
  };
}

export class BraveSearchAdapter implements BridgeAdapter {
  name = 'web_search';
  description = 'Search the web for current information. Returns titles, URLs, and snippets from top results.';
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      count: { type: 'number', description: 'Number of results (1–10, default 5)' },
    },
    required: ['query'],
  };

  async call({ query, count = 5 }: { query: string; count?: number }): Promise<string> {
    const n = Math.min(Math.max(count, 1), 10);
    // Brave API limit: 50 words max
    const safeQuery = query.split(/\s+/).slice(0, 48).join(' ');
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(safeQuery)}&count=${n}&search_lang=en`;

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY ?? '',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brave Search API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as BraveSearchResponse;
    const results = data.web?.results ?? [];

    if (!results.length) return 'No results found.';

    return results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.description ?? '(no snippet)'}\n   ${r.url}`,
    ).join('\n\n');
  }
}
