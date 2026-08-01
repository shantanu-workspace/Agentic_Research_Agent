import type { AnalyzedPaper } from "./analyzePapers";

export interface RankedPaper extends AnalyzedPaper {
  qualityScore: number;
  finalScore: number;
  rank: number;
}

const WEIGHTS = {
  relevance: 0.65, // LLM's judgment of fit to the specific question — dominant signal
  citations: 0.25, // log-scaled citation count — proxy for external validation/impact
  recency: 0.10,   // mild bonus for recent work, since a field can move past old papers
};

/**
 * Step 5. Combines the LLM's relevance judgment with objective signals
 * (citation count, recency) into one final ranking. Relevance is weighted
 * most heavily deliberately — a highly-cited but off-topic paper shouldn't
 * outrank a spot-on recent paper with few citations, which is exactly the
 * failure mode of ranking by citations alone.
 */
export function rankPapers(analyzed: AnalyzedPaper[]): RankedPaper[] {
  const currentYear = new Date().getFullYear();

  // Normalize citation log-scores to 0-100 across this result set so the
  // weighting is meaningful regardless of whether these are a niche subfield
  // (max ~50 citations) or a mainstream one (max ~50,000).
  const citationLogScores = analyzed.map((a) => Math.log10((a.paper.citationCount ?? 0) + 1));
  const maxCitationLog = Math.max(...citationLogScores, 1);

  const scored = analyzed.map((a, i) => {
    const citationScore = (citationLogScores[i] / maxCitationLog) * 100;

    const age = a.paper.year ? Math.max(currentYear - a.paper.year, 0) : 20;
    const recencyScore = Math.max(0, 100 - age * 8); // ~12.5 year decay to 0

    const qualityScore = citationScore * 0.7 + recencyScore * 0.3;

    const finalScore =
      a.analysis.relevanceScore * WEIGHTS.relevance +
      citationScore * WEIGHTS.citations +
      recencyScore * WEIGHTS.recency;

    return { ...a, qualityScore, finalScore };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
