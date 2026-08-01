import { searchMultiplePhrasings, type RawPaper } from "../openAlex";

/**
 * Step 2. Fan out the planned search phrasings to OpenAlex and
 * merge+dedupe by paperId. Thin wrapper kept separate from the S2 client
 * so the pipeline's control flow reads top-to-bottom in one place.
 */
export async function searchPapers(phrasings: string[]): Promise<RawPaper[]> {
  if (phrasings.length === 0) return [];
  return searchMultiplePhrasings(phrasings, 20);
}
