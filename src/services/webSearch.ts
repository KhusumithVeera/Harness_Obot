import { SourceCitation } from '../types';
import { providerFetch } from './network';

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

export function getCurrentMonthKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `harness:tavilyUsage:${year}-${month}`;
}

export function getTavilyUsage(): number {
  try {
    const raw = localStorage.getItem(getCurrentMonthKey());
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function incrementTavilyUsage(): number {
  try {
    const current = getTavilyUsage();
    const updated = current + 1;
    localStorage.setItem(getCurrentMonthKey(), String(updated));
    return updated;
  } catch {
    return 0;
  }
}

export function isTavilyQuotaReached(): boolean {
  return getTavilyUsage() >= 1000;
}

export function isTavilyNearLimit(): boolean {
  return getTavilyUsage() >= 800;
}

export function buildSearchQuery(currentMessage: string, previousUserMessage?: string): string {
  if (!previousUserMessage) return currentMessage.trim();
  const words = currentMessage.trim().split(/\s+/);
  const startsWithPronoun = /^(it|this|that|these|those|what about|how about|and|why|who|which)\b/i.test(
    currentMessage.trim()
  );
  if (words.length <= 6 || startsWithPronoun) {
    return `${previousUserMessage.trim()} ${currentMessage.trim()}`;
  }
  return currentMessage.trim();
}

export async function searchTavily(
  query: string,
  apiKey: string
): Promise<{ sources: SourceCitation[]; searchContext: string }> {
  if (isTavilyQuotaReached()) {
    throw new Error('Free monthly limit reached (1,000 / 1,000). Resets on the 1st.');
  }

  const res = await providerFetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      include_answer: false,
      search_depth: 'basic',
    }),
    providerName: 'Tavily',
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Invalid Tavily key');
    }
    if (res.status === 429) {
      throw new Error('Search quota reached');
    }
    throw new Error(`Tavily search error: ${res.status}`);
  }

  const data = await res.json();
  incrementTavilyUsage();

  const sources: SourceCitation[] = [];
  const lines: string[] = [];

  const results: TavilySearchResult[] = data.results || [];
  results.forEach((r, idx) => {
    let domain = '';
    try {
      domain = new URL(r.url).hostname.replace('www.', '');
    } catch {
      domain = 'web';
    }

    const citationNumber = idx + 1;
    sources.push({
      type: 'web',
      title: r.title || domain,
      url: r.url,
      snippet: r.content || '',
    });

    lines.push(`[${citationNumber}] (${domain}) ${r.content}`);
  });

  return {
    sources,
    searchContext: lines.join('\n\n'),
  };
}
