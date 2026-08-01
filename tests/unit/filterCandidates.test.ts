import { describe, it, expect } from "vitest";
import { filterCandidates } from "@/lib/pipeline/filterCandidates";
import type { RawPaper } from "@/lib/openAlex";

function makePaper(overrides: Partial<RawPaper> = {}): RawPaper {
  return {
    paperId: Math.random().toString(36).slice(2),
    title: "A Paper",
    abstract: "This is a sufficiently long abstract describing the paper's contribution in detail.",
    authors: [{ authorId: "1", name: "A. Author" }],
    year: 2023,
    venue: "NeurIPS",
    citationCount: 10,
    url: "https://example.com",
    tldr: null,
    externalIds: null,
    ...overrides,
  };
}

describe("filterCandidates", () => {
  it("drops papers with no abstract", () => {
    const papers = [makePaper({ abstract: null }), makePaper()];
    const result = filterCandidates(papers);
    expect(result).toHaveLength(1);
    expect(result[0].abstract).not.toBeNull();
  });

  it("drops papers with a very short/junk abstract", () => {
    const papers = [makePaper({ abstract: "Too short." }), makePaper()];
    const result = filterCandidates(papers);
    expect(result).toHaveLength(1);
  });

  it("caps results to maxCandidates", () => {
    const papers = Array.from({ length: 50 }, (_, i) => makePaper({ citationCount: i }));
    const result = filterCandidates(papers, { maxCandidates: 10 });
    expect(result).toHaveLength(10);
  });

  it("ranks higher-citation papers above lower-citation ones of the same age", () => {
    const low = makePaper({ paperId: "low", citationCount: 2, year: 2020 });
    const high = makePaper({ paperId: "high", citationCount: 5000, year: 2020 });
    const result = filterCandidates([low, high]);
    expect(result[0].paperId).toBe("high");
  });

  it("gives recent low-citation papers a boost over old low-citation papers", () => {
    const currentYear = new Date().getFullYear();
    const old = makePaper({ paperId: "old", citationCount: 1, year: currentYear - 20 });
    const recent = makePaper({ paperId: "recent", citationCount: 1, year: currentYear });
    const result = filterCandidates([old, recent]);
    expect(result[0].paperId).toBe("recent");
  });

  it("filters out papers below minYear when specified", () => {
    const papers = [makePaper({ year: 2010 }), makePaper({ year: 2023 })];
    const result = filterCandidates(papers, { minYear: 2020 });
    expect(result).toHaveLength(1);
    expect(result[0].year).toBe(2023);
  });

  it("returns an empty array for empty input", () => {
    expect(filterCandidates([])).toEqual([]);
  });
});
