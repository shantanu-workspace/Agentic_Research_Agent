import type { RawPaper } from "../openAlex";

export interface FilterOptions {
  maxCandidates?: number;
  minYear?: number;
  /**
   * Words/phrases describing what the result should actually be about — pass
   * the raw query plus planQuery's coreConcepts. Used for a cheap keyword-
   * overlap relevance check. Without this, the filter has no idea what the
   * search was even for, and a landmark paper with 50,000 citations in a
   * totally different subfield will always beat a niche-but-on-topic one.
   */
  queryTerms?: string[];
}

const STOPWORDS = new Set([
  "how", "what", "why", "when", "does", "do", "the", "a", "an", "of", "and",
  "for", "with", "in", "on", "to", "is", "are", "handle", "using",
]);

function extractTerms(queryTerms: string[]): string[] {
  const words = queryTerms
    .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return Array.from(new Set(words));
}

/**
 * Step 3. Cuts the raw candidate pool down before it hits the LLM, since
 * every surviving paper costs one Groq call in step 4. Three jobs:
 *
 *  1. Drop papers with no abstract — the LLM has nothing to analyze, and in
 *     practice these are almost always low-quality index entries (posters,
 *     stubs, non-English metadata-only records).
 *  2. Score by topical relevance (keyword overlap with the query/core
 *     concepts) first — this is what keeps an off-topic blockbuster paper
 *     (tens of thousands of citations, wrong subfield) from occupying a slot
 *     that a real candidate needed. Citation count and recency only break
 *     ties among papers that are actually about the right thing.
 *  3. Cap to `maxCandidates` so the survivors are a reasonable pre-filter —
 *     not the final ranking, just triage before the expensive LLM call.
 */
export function filterCandidates(
  papers: RawPaper[],
  opts: FilterOptions = {}
): RawPaper[] {
  const { maxCandidates = 25, minYear, queryTerms = [] } = opts;
  const currentYear = new Date().getFullYear();
  const terms = extractTerms(queryTerms);

  let candidates = papers.filter((p) => {
    if (!p.abstract || p.abstract.trim().length < 40) return false;
    if (minYear && (p.year ?? 0) < minYear) return false;
    return true;
  });

  const relevanceScore = (p: RawPaper): number => {
    if (terms.length === 0) return 0;
    const haystack = `${p.title} ${p.abstract ?? ""}`.toLowerCase();
    const hits = terms.filter((t) => haystack.includes(t)).length;
    return hits / terms.length; // 0..1
  };

  const heuristicScore = (p: RawPaper): number => {
    const citationScore = Math.log10((p.citationCount ?? 0) + 1);
    const age = p.year ? Math.max(currentYear - p.year, 0) : 15;
    // Recency bonus decays over ~10 years; keeps brand-new low-citation papers
    // from being invisible next to decade-old highly-cited landmark papers.
    const recencyScore = Math.max(0, 1 - age / 10);
    // Relevance is weighted well above citations/recency deliberately — those
    // two should only decide ordering among papers that are already on-topic.
    return relevanceScore(p) * 4.0 + citationScore * 1.0 + recencyScore * 1.5;
  };

  candidates = candidates.sort((a, b) => heuristicScore(b) - heuristicScore(a));

  return candidates.slice(0, maxCandidates);
}