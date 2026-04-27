export interface BraveResult {
  title:   string;
  snippet: string;
  url:     string;
}

export async function braveSearch(query: string, count = 5): Promise<BraveResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_API_KEY not set');

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));

  const res = await fetch(url.toString(), {
    headers: {
      'Accept':               'application/json',
      'X-Subscription-Token': key,
    },
  });

  if (!res.ok) throw new Error(`Brave Search ${res.status}: ${await res.text()}`);

  const data = await res.json() as { web?: { results?: Array<{ title: string; description?: string; url: string }> } };

  return (data.web?.results ?? []).map((r) => ({
    title:   r.title,
    snippet: r.description ?? '',
    url:     r.url,
  }));
}

export function formatSearchResults(results: BraveResult[]): string {
  if (!results.length) return '[No search results found]';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`)
    .join('\n\n');
}
