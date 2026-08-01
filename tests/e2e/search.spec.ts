import { test, expect } from "@playwright/test";

// These E2E tests mock /api/search at the network layer so the UI can be
// verified deterministically without spending real Groq/Semantic Scholar
// calls on every CI run. A separate manual smoke test (see README) hits the
// real pipeline before each deploy.

function sseBody(events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

test.describe("Research Assistant search flow", () => {
  test("renders the landing page with search input and example queries", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Research Assistant Agent" })).toBeVisible();
    await expect(page.getByPlaceholder(/How do LLMs handle/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /search/i })).toBeDisabled();
  });

  test("shows agent step progress while the pipeline runs, then renders ranked results", async ({
    page,
  }) => {
    await page.route("**/api/search", async (route) => {
      const body = sseBody([
        { type: "progress", stage: "planning" },
        { type: "progress", stage: "searching", detail: "3 phrasings" },
        { type: "progress", stage: "filtering", detail: "18 raw candidates" },
        { type: "progress", stage: "analyzing", detail: "12 papers" },
        { type: "progress", stage: "ranking" },
        {
          type: "result",
          queryId: "test-query-id",
          rankedPapers: [
            {
              rank: 1,
              finalScore: 88.5,
              analysis: {
                relevanceScore: 92,
                contribution: "Introduces a retrieval-augmented approach that reduces hallucination.",
                method: "Combines a dense retriever with a frozen LLM.",
                rationale: "Directly addresses the query's focus on hallucination reduction.",
              },
              paper: {
                paperId: "abc123",
                title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP",
                authors: [{ name: "P. Lewis" }, { name: "E. Perez" }],
                year: 2020,
                venue: "NeurIPS",
                citationCount: 4500,
                url: "https://example.com/paper",
              },
            },
          ],
        },
      ]);

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    await page.goto("/");
    await page.getByPlaceholder(/How do LLMs handle/i).fill("retrieval augmented generation");
    await page.getByRole("button", { name: /search/i }).click();

    await expect(page.getByText("Reading & scoring papers")).toBeVisible();

    await expect(
      page.getByText("Retrieval-Augmented Generation for Knowledge-Intensive NLP")
    ).toBeVisible();
    await expect(page.getByText("92/100 relevant")).toBeVisible();
    await expect(page.getByText(/4,500 citations/)).toBeVisible();
  });

  test("shows an error state when the pipeline fails", async ({ page }) => {
    await page.route("**/api/search", async (route) => {
      const body = sseBody([{ type: "error", message: "Groq API key is invalid" }]);
      await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });

    await page.goto("/");
    await page.getByPlaceholder(/How do LLMs handle/i).fill("a valid looking query");
    await page.getByRole("button", { name: /search/i }).click();

    await expect(page.getByText("Search failed")).toBeVisible();
    await expect(page.getByText("Groq API key is invalid")).toBeVisible();
  });

  test("shows empty state when no papers are found", async ({ page }) => {
    await page.route("**/api/search", async (route) => {
      const body = sseBody([{ type: "result", queryId: "empty-id", rankedPapers: [] }]);
      await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });

    await page.goto("/");
    await page.getByPlaceholder(/How do LLMs handle/i).fill("an extremely obscure query xyz");
    await page.getByRole("button", { name: /search/i }).click();

    await expect(page.getByText(/No relevant papers found/i)).toBeVisible();
  });

  test("clicking an example query triggers a search", async ({ page }) => {
    await page.route("**/api/search", async (route) => {
      const body = sseBody([{ type: "result", queryId: "x", rankedPapers: [] }]);
      await route.fulfill({ status: 200, contentType: "text/event-stream", body });
    });

    await page.goto("/");
    const exampleButton = page.getByRole("button", {
      name: "How do large language models handle in-context learning?",
    });
    await exampleButton.click();

    await expect(page.getByPlaceholder(/How do LLMs handle/i)).toHaveValue(
      "How do large language models handle in-context learning?"
    );
  });
});
