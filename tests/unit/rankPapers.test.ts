import { describe, it, expect } from "vitest";
import { rankPapers } from "@/lib/pipeline/rankPapers";
import type { AnalyzedPaper } from "@/lib/pipeline/analyzePapers";
import type { RawPaper } from "@/lib/openAlex";

function makeAnalyzed(overrides: {
  paperId: string;
  relevanceScore: number;
  citationCount?: number;
  year?: number;
}): AnalyzedPaper {
  const paper: RawPaper = {
    paperId: overrides.paperId,
    title: `Paper ${overrides.paperId}`,
    abstract: "Some abstract.",
    authors: [{ authorId: "1", name: "Author" }],
    year: overrides.year ?? 2023,
    venue: "Venue",
    citationCount: overrides.citationCount ?? 0,
    url: null,
    tldr: null,
    externalIds: null,
  };
  return {
    paper,
    analysis: {
      contribution: "Contributes something.",
      method: "Uses a method.",
      relevanceScore: overrides.relevanceScore,
      rationale: "Because reasons.",
    },
  };
}

describe("rankPapers", () => {
  it("assigns sequential 1-indexed ranks in descending finalScore order", () => {
    const input = [
      makeAnalyzed({ paperId: "a", relevanceScore: 40 }),
      makeAnalyzed({ paperId: "b", relevanceScore: 90 }),
      makeAnalyzed({ paperId: "c", relevanceScore: 65 }),
    ];
    const ranked = rankPapers(input);

    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].paper.paperId).toBe("b");
    expect(ranked[1].paper.paperId).toBe("c");
    expect(ranked[2].paper.paperId).toBe("a");
  });

  it("weighs relevance heavily enough that a highly relevant, low-citation paper beats a barely-relevant, highly-cited one", () => {
    const irrelevantButFamous = makeAnalyzed({
      paperId: "famous",
      relevanceScore: 15,
      citationCount: 50000,
      year: 2015,
    });
    const relevantButObscure = makeAnalyzed({
      paperId: "obscure",
      relevanceScore: 95,
      citationCount: 3,
      year: 2024,
    });

    const ranked = rankPapers([irrelevantButFamous, relevantButObscure]);
    expect(ranked[0].paper.paperId).toBe("obscure");
  });

  it("produces finalScore and qualityScore as finite numbers within a sane range", () => {
    const input = [makeAnalyzed({ paperId: "a", relevanceScore: 70, citationCount: 200, year: 2022 })];
    const [result] = rankPapers(input);

    expect(Number.isFinite(result.finalScore)).toBe(true);
    expect(Number.isFinite(result.qualityScore)).toBe(true);
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(100);
  });

  it("handles a single-paper list without divide-by-zero issues", () => {
    const input = [makeAnalyzed({ paperId: "solo", relevanceScore: 50, citationCount: 0 })];
    const ranked = rankPapers(input);
    expect(ranked).toHaveLength(1);
    expect(Number.isFinite(ranked[0].finalScore)).toBe(true);
  });

  it("returns an empty array for empty input", () => {
    expect(rankPapers([])).toEqual([]);
  });
});
