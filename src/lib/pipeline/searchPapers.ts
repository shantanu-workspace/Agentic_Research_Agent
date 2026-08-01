import { searchMultiplePhrasings, type RawPaper } from "../openAlex";
import { searchArxivMultiplePhrasings } from "../arXiv";
import type { QueryPlan } from "./planQuery";

/**
 * Step 2. Fan out the planned search phrasings to whichever provider(s) the
 * planner selected, and merge+dedupe by paperId. A paper independently
 * indexed by both providers (rare, since arXiv preprints and OpenAlex works
 * use different ID schemes) will appear twice — acceptable for now since
 * dedup would require title-similarity matching, not a cheap ID comparison.
 */
export async function searchPapers(plan: Pick<QueryPlan, "searchPhrasings" | "providers">): Promise<RawPaper[]> {
  const { searchPhrasings: phrasings, providers } = plan;
  if (phrasings.length === 0) return [];

  const seen = new Map<string, RawPaper>();

  if (providers.includes("openalex")) {
    for (const paper of await searchMultiplePhrasings(phrasings, 20)) {
      if (!seen.has(paper.paperId)) seen.set(paper.paperId, paper);
    }
  }

  if (providers.includes("arxiv")) {
    for (const paper of await searchArxivMultiplePhrasings(phrasings, 20)) {
      if (!seen.has(paper.paperId)) seen.set(paper.paperId, paper);
    }
  }

  return Array.from(seen.values());
}