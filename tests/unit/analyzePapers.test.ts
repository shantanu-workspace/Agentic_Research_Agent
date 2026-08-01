import { describe, it, expect, vi } from "vitest";
import { analyzePapers } from "@/lib/pipeline/analyzePapers";
import type { RawPaper } from "@/lib/openAlex";
import type { QueryPlan } from "@/lib/pipeline/planQuery";

vi.mock("@/lib/groq", () => ({
  groqJson: vi.fn(),
}));

import { groqJson } from "@/lib/groq";

function makePaper(id: string): RawPaper {
  return {
    paperId: id,
    title: `Paper ${id}`,
    abstract: "An abstract.",
    authors: [{ authorId: "1", name: "Author" }],
    year: 2023,
    venue: "Venue",
    citationCount: 5,
    url: null,
    tldr: null,
    externalIds: null,
  };
}

const plan: QueryPlan = { coreConcepts: ["testing"], searchPhrasings: ["test query"] };

describe("analyzePapers", () => {
  it("returns an analysis for every paper when all Groq calls succeed", async () => {
    (groqJson as ReturnType<typeof vi.fn>).mockResolvedValue({
      contribution: "Does something useful.",
      method: "Uses a novel method.",
      relevanceScore: 80,
      rationale: "Directly on topic.",
    });

    const papers = [makePaper("a"), makePaper("b"), makePaper("c")];
    const result = await analyzePapers("test query", plan, papers);

    expect(result).toHaveLength(3);
    expect(groqJson).toHaveBeenCalledTimes(3);
  });

  it("drops papers whose Groq call fails, without throwing", async () => {
    (groqJson as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        contribution: "ok",
        method: "ok",
        relevanceScore: 50,
        rationale: "ok",
      })
      .mockRejectedValueOnce(new Error("Groq failed"));

    const papers = [makePaper("a"), makePaper("b")];
    const result = await analyzePapers("test query", plan, papers);

    expect(result).toHaveLength(1);
    expect(result[0].paper.paperId).toBe("a");
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    (groqJson as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { contribution: "ok", method: "ok", relevanceScore: 50, rationale: "ok" };
    });

    const papers = Array.from({ length: 8 }, (_, i) => makePaper(String(i)));
    await analyzePapers("test query", plan, papers, 2);

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("returns an empty array when given no papers", async () => {
    const result = await analyzePapers("test query", plan, []);
    expect(result).toEqual([]);
  });
});
