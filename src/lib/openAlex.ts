import { withRetry } from "./utils";

const BASE_URL = "https://api.openalex.org/works";

/**
 * Kept identical in shape to the old Semantic Scholar RawPaper type so the
 * rest of the pipeline (filterCandidates, analyzePapers, rankPapers) didn't
 * need to change at all when swapping paper sources.
 */
export interface RawPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  authors: { authorId: string | null; name: string }[];
  year: number | null;
  venue: string | null;
  citationCount: number;
  url: string | null;
  tldr: { text: string } | null; // OpenAlex has no TLDR field; always null here
  externalIds: Record<string, string> | null;
  source: "openalex" | "arxiv";
}

interface OpenAlexAuthorship {
  author?: { id?: string; display_name?: string };
}

interface OpenAlexWork {
  id: string; // e.g. "https://openalex.org/W2741809807"
  display_name: string | null;
  abstract_inverted_index: Record<string, number[]> | null;
  authorships: OpenAlexAuthorship[];
  publication_year: number | null;
  primary_location: { source?: { display_name?: string | null } | null } | null;
  cited_by_count: number;
  doi: string | null; // already a full URL, e.g. "https://doi.org/10.xxxx"
}

/**
 * OpenAlex stores abstracts as an "inverted index" (word -> positions) rather
 * than plain text, for licensing reasons. Rebuild the plain-text abstract by
 * placing each word back at its recorded position.
 */
function reconstructAbstract(index: Record<string, number[]> | null): string | null {
  if (!index || Object.keys(index).length === 0) return null;

  let maxPos = 0;
  for (const positions of Object.values(index)) {
    for (const p of positions) maxPos = Math.max(maxPos, p);
  }

  const words: string[] = new Array(maxPos + 1).fill("");
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }

  return words.join(" ").replace(/\s+/g, " ").trim() || null;
}

function toRawPaper(work: OpenAlexWork): RawPaper {
  const shortId = work.id.replace("https://openalex.org/", "");

  return {
    paperId: shortId,
    title: work.display_name ?? "Untitled",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: (work.authorships ?? [])
      .map((a) => ({
        authorId: a.author?.id?.replace("https://openalex.org/", "") ?? null,
        name: a.author?.display_name ?? "Unknown author",
      }))
      .filter((a) => a.name !== "Unknown author" || work.authorships.length === 1),
    year: work.publication_year,
    venue: work.primary_location?.source?.display_name ?? null,
    citationCount: work.cited_by_count ?? 0,
    url: work.doi ?? `https://openalex.org/${shortId}`,
    tldr: null,
    externalIds: work.doi ? { DOI: work.doi.replace("https://doi.org/", "") } : null,
    source: "openalex"
  };
}

const SELECT_FIELDS = [
  "id",
  "display_name",
  "abstract_inverted_index",
  "authorships",
  "publication_year",
  "primary_location",
  "cited_by_count",
  "doi",
].join(",");

/**
 * Search OpenAlex's `/works` endpoint for a single phrasing.
 * No API key required. Set OPENALEX_MAILTO to join the "polite pool" for a
 * higher, more consistent rate limit (OpenAlex's ask, not a hard requirement).
 * `filter=has_abstract:true` pushes the no-abstract exclusion upstream, so
 * fewer wasted slots in filterCandidates' downstream cap.
 */
export async function searchOpenAlex(query: string, limit = 20): Promise<RawPaper[]> {
  const params = new URLSearchParams({
    search: query,
    per_page: String(limit),
    select: SELECT_FIELDS,
    filter: "has_abstract:true",
  });

  if (process.env.OPENALEX_MAILTO) {
    params.set("mailto", process.env.OPENALEX_MAILTO);
  }

  return withRetry(
    async () => {
      const res = await fetch(`${BASE_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status === 429) {
        throw new Error("OpenAlex rate limit hit (429)");
      }
      if (!res.ok) {
        throw new Error(`OpenAlex search failed: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const works = (data.results ?? []) as OpenAlexWork[];
      return works.map(toRawPaper);
    },
    { label: `OpenAlex search "${query}"`, retries: 3, baseDelayMs: 800 }
  );
}

/**
 * Run multiple search phrasings (from planQuery) sequentially and merge+dedupe
 * by paperId. Sequential (not parallel) to stay well inside OpenAlex's
 * unauthenticated rate limit even without a mailto set.
 */
export async function searchMultiplePhrasings(
  phrasings: string[],
  perQueryLimit = 20
): Promise<RawPaper[]> {
  const seen = new Map<string, RawPaper>();

  for (const phrasing of phrasings) {
    try {
      const results = await searchOpenAlex(phrasing, perQueryLimit);
      for (const paper of results) {
        if (!seen.has(paper.paperId)) {
          seen.set(paper.paperId, paper);
        }
      }
    } catch (err) {
      console.error(`[searchMultiplePhrasings] phrasing "${phrasing}" failed:`, err);
    }
  }

  return Array.from(seen.values());
}
