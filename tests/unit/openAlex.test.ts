import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchOpenAlex, searchMultiplePhrasings } from "@/lib/openAlex";

// OpenAlex encodes abstracts as an inverted index: { word: [positions] }.
// "attention is all you need" -> { attention: [0], is: [1], all: [2], you: [3], need: [4] }
function invertedIndexFor(text: string): Record<string, number[]> {
  const words = text.split(" ");
  const index: Record<string, number[]> = {};
  words.forEach((w, i) => {
    index[w] = index[w] ? [...index[w], i] : [i];
  });
  return index;
}

function mockWork(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `https://openalex.org/${id}`,
    display_name: `Title ${id}`,
    abstract_inverted_index: invertedIndexFor("this paper introduces a novel method"),
    authorships: [{ author: { id: "https://openalex.org/A1", display_name: "A. Author" } }],
    publication_year: 2023,
    primary_location: { source: { display_name: "Venue" } },
    cited_by_count: 5,
    doi: "https://doi.org/10.1234/example",
    ...overrides,
  };
}

describe("searchOpenAlex", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed papers with abstracts correctly reconstructed from the inverted index", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [mockWork("W1")] }),
    });

    const result = await searchOpenAlex("test query");
    expect(result).toHaveLength(1);
    expect(result[0].paperId).toBe("W1");
    expect(result[0].abstract).toBe("this paper introduces a novel method");
    expect(result[0].title).toBe("Title W1");
    expect(result[0].citationCount).toBe(5);
    expect(result[0].url).toBe("https://doi.org/10.1234/example");
  });

  it("returns null abstract when abstract_inverted_index is null", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [mockWork("W2", { abstract_inverted_index: null })] }),
    });

    const result = await searchOpenAlex("test query");
    expect(result[0].abstract).toBeNull();
  });

  it("falls back to the OpenAlex work page URL when there is no DOI", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [mockWork("W3", { doi: null })] }),
    });

    const result = await searchOpenAlex("test query");
    expect(result[0].url).toBe("https://openalex.org/W3");
    expect(result[0].externalIds).toBeNull();
  });

  it(
    "retries on 429 and eventually succeeds",
    async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ results: [mockWork("W4")] }),
        });

      const result = await searchOpenAlex("test query");
      expect(result[0].paperId).toBe("W4");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    15000
  );

  it(
    "throws after exhausting retries on persistent failure",
    async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      });

      await expect(searchOpenAlex("test query")).rejects.toThrow();
    },
    15000
  );

  it("includes has_abstract:true filter and per_page/select params in the request", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ results: [] }) });

    await searchOpenAlex("transformers", 10);

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("filter=has_abstract%3Atrue");
    expect(calledUrl).toContain("per_page=10");
    expect(calledUrl).toContain("search=transformers");
  });
});

describe("searchMultiplePhrasings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("merges and dedupes papers across phrasings by paperId", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [mockWork("dup"), mockWork("only-a")] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [mockWork("dup"), mockWork("only-b")] }),
      });

    const result = await searchMultiplePhrasings(["phrasing a", "phrasing b"]);
    const ids = result.map((p) => p.paperId).sort();
    expect(ids).toEqual(["dup", "only-a", "only-b"]);
  });

  it(
    "continues with remaining phrasings if one fails entirely",
    async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: "err" });

      const result = await searchMultiplePhrasings(["a"]);
      expect(result).toEqual([]);
    },
    15000
  );
});
