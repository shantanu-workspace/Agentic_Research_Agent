import { searchMultiplePhrasings, type RawPaper } from "../openAlex";
import { searchArxivMultiplePhrasings } from "../arXiv";
import type { QueryPlan } from "./planQuery";

export async function searchPapers(plan: QueryPlan): Promise<RawPaper[]> {
  let papers: RawPaper[] = [];

  if (plan.providers.includes("openalex")) {
    papers.push(...(await searchMultiplePhrasings(plan.searchPhrasings)));
  }

  if (plan.providers.includes("arxiv")) {
    papers.push(...(await searchArxivMultiplePhrasings(plan.searchPhrasings)));
  }

  return papers;
}
