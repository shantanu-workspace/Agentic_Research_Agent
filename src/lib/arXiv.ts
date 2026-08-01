import { withRetry } from "./utils";
import type { RawPaper } from "./openAlex";

const BASE_URL = "http://export.arxiv.org/api/query";

//arXiv.ts
/**
 * arXiv's API returns Atom XML, not JSON, and has no official JS SDK. Rather
 * than pull in a full XML parser dependency for a handful of fixed fields,
 * this extracts each <entry>...</entry> block and regexes out the specific
 * tags we need. arXiv's feed structure is stable/documented, so this is a
 * reasonable trade — revisit with a real parser (e.g. fast-xml-parser) if
 * the tag set ever needs to grow much beyond this.
 */
function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAuthors(entryXml: string): { authorId: string | null; name: string }[] {
  const authorBlocks = entryXml.match(/<author>[\s\S]*?<\/author>/g) ?? [];
  return authorBlocks
    .map((block) => extractTag(block, "name"))
    .filter((name): name is string => !!name)
    .map((name) => ({ authorId: null, name }));
}

function parseEntry(entryXml: string): RawPaper | null {
  const idUrl = extractTag(entryXml, "id"); // e.g. http://arxiv.org/abs/2401.12345v2
  const title = extractTag(entryXml, "title");
  const summary = extractTag(entryXml, "summary");
  const published = extractTag(entryXml, "published"); // e.g. 2024-01-23T18:00:00Z

  if (!idUrl || !title) return null;

  const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
  const year = published ? Number(published.slice(0, 4)) : null;

  return {
    paperId: `arXiv:${arxivId}`,
    title,
    abstract: summary,
    authors: extractAuthors(entryXml),
    year: Number.isFinite(year) ? year : null,
    venue: "arXiv preprint",
    citationCount: 0, // arXiv's API doesn't expose citation counts
    url: `https://arxiv.org/abs/${arxivId}`,
    tldr: null,
    externalIds: { arXiv: arxivId },
  };
}

/**
 * Search arXiv's `/api/query` endpoint for a single phrasing. No API key
 * required. Searches title+abstract (`all:`) rather than a specific field,
 * since our phrasings are generated for keyword search, not arXiv's query
 * grammar.
 */
export async function searchArxiv(query: string, limit = 20): Promise<RawPaper[]> {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: "0",
    max_results: String(limit),
    sortBy: "relevance",
    sortOrder: "descending",
  });

  return withRetry(
    async () => {
      const res = await fetch(`${BASE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        throw new Error("arXiv rate limit hit (429)");
      }
      if (!res.ok) {
        throw new Error(`arXiv search failed: ${res.status} ${res.statusText}`);
      }

      const xml = await res.text();
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
      return entries
        .map(parseEntry)
        .filter((p): p is RawPaper => p !== null && !!p.abstract && p.abstract.length >= 40);
    },
    { label: `arXiv search "${query}"`, retries: 3, baseDelayMs: 800 }
  );
}

/**
 * Run multiple search phrasings sequentially and merge+dedupe by paperId —
 * mirrors searchMultiplePhrasings in openAlex.ts. Sequential to stay well
 * within arXiv's documented rate limit (one request per ~3s recommended).
 */
export async function searchArxivMultiplePhrasings(
  phrasings: string[],
  perQueryLimit = 20
): Promise<RawPaper[]> {
  const seen = new Map<string, RawPaper>();

  for (const phrasing of phrasings) {
    try {
      const results = await searchArxiv(phrasing, perQueryLimit);
      for (const paper of results) {
        if (!seen.has(paper.paperId)) {
          seen.set(paper.paperId, paper);
        }
      }
    } catch (err) {
      console.error(`[searchArxivMultiplePhrasings] phrasing "${phrasing}" failed:`, err);
    }
  }

  return Array.from(seen.values());
}