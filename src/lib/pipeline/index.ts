import { prisma } from "../prisma";
import { planQuery } from "./planQuery";
import { searchPapers } from "./searchPapers";
import { filterCandidates } from "./filterCandidates";
import { analyzePapers } from "./analyzePapers";
import { rankPapers, type RankedPaper } from "./rankPapers";
import { DISCARD_THRESHOLD } from "./confidence";

export type PipelineStage =
  | "planning"
  | "searching"
  | "filtering"
  | "analyzing"
  | "ranking"
  | "confidence"
  | "done";

export interface PipelineProgress {
  stage: PipelineStage;
  detail?: string;
}

export interface PipelineStats {
  /** Raw papers retrieved from OpenAlex across all search phrasings, before any filtering. */
  papersSearched: number;
  /** Papers that survived the pre-filter and were actually sent to the LLM. */
  papersAnalyzed: number;
  /** Papers that cleared the confidence threshold and are shown to the user. */
  papersPassed: number;
}

export interface SearchStrategy {
  providers: ("openalex" | "arxiv")[];
  reason: string;
}

export interface PipelineResult {
  queryId: string;
  rankedPapers: RankedPaper[];
  stats: PipelineStats;
  searchStrategy: SearchStrategy;
}

/**
 * Orchestrates the full agent pipeline end to end and persists results.
 * `onProgress` is optional — lets the API route stream stage updates to the
 * frontend (see /api/search/route.ts) so the UI can show what the agent is
 * doing rather than a single opaque spinner.
 */
export async function runPipeline(
  rawQuery: string,
  onProgress?: (p: PipelineProgress) => void
): Promise<PipelineResult> {
  const notify = (stage: PipelineStage, detail?: string) => onProgress?.({ stage, detail });

  // Create the Query row up front (status=running) so partial/failed runs are still visible.
  const queryRow = await prisma.query.create({
    data: { rawQuery, expandedKeywords: [], status: "running" },
  });

  try {
    notify("planning");
    const plan = await planQuery(rawQuery);
    await prisma.query.update({
      where: { id: queryRow.id },
      data: { expandedKeywords: plan.searchPhrasings },
    });

    notify(
      "searching",
      `${plan.providers.join(" + ")} · ${plan.searchPhrasings.length} phrasings`
    );
    const rawResults = await searchPapers(plan);
    const searchStrategy: SearchStrategy = {
      providers: plan.providers,
      reason: plan.providerReason,
    };

    if (rawResults.length === 0) {
      await prisma.query.update({
        where: { id: queryRow.id },
        data: { status: "complete", completedAt: new Date() },
      });
      return {
        queryId: queryRow.id,
        rankedPapers: [],
        stats: { papersSearched: 0, papersAnalyzed: 0, papersPassed: 0 },
        searchStrategy,
      };
    }

    notify("filtering", `${rawResults.length} raw candidates`);
    const candidates = filterCandidates(rawResults, {
      maxCandidates: 8,
      queryTerms: [rawQuery, ...plan.coreConcepts],
    });

    notify("analyzing", `${candidates.length} papers`);
    const analyzed = await analyzePapers(rawQuery, plan, candidates);

    notify("ranking");
    const ranked = rankPapers(analyzed);

    // Quality over quantity: a paper that was merely *retrieved* isn't the same
    // as a paper that's actually relevant. Discard anything the LLM scored below
    // the confidence threshold rather than showing it just because it survived
    // the earlier pre-filter — the user should see "4 papers satisfied your
    // query", not "8 papers, several of which are only tangentially related".
    const confident = ranked
      .filter((r) => r.analysis.relevanceScore >= DISCARD_THRESHOLD)
      .slice(0, 15)
      .map((r, i) => ({ ...r, rank: i + 1 })); // re-rank #1..#N — no gaps from discarded papers
    notify("confidence", `${confident.length}/${ranked.length} passed threshold`);

    const stats: PipelineStats = {
      papersSearched: rawResults.length,
      papersAnalyzed: candidates.length,
      papersPassed: confident.length,
    };

    // Persist papers (upsert — papers are shared/cached across queries) and results.
    // Only the confidence-filtered set — discarded low-relevance candidates
    // never make it into the DB or the response.
    await prisma.$transaction([
      ...confident.map((r) =>
        prisma.paper.upsert({
          where: { id: r.paper.paperId },
          create: {
            id: r.paper.paperId,
            title: r.paper.title,
            abstract: r.paper.abstract,
            authors: r.paper.authors as object,
            year: r.paper.year,
            venue: r.paper.venue,
            citationCount: r.paper.citationCount ?? 0,
            url: r.paper.url,
            tldr: r.paper.tldr?.text ?? null,
            externalIds: r.paper.externalIds as object | undefined,
          },
          update: {
            citationCount: r.paper.citationCount ?? 0,
          },
        })
      ),
      ...confident.map((r) =>
        prisma.queryResult.create({
          data: {
            queryId: queryRow.id,
            paperId: r.paper.paperId,
            relevanceScore: r.analysis.relevanceScore,
            qualityScore: r.qualityScore,
            finalScore: r.finalScore,
            llmSummary: `${r.analysis.contribution} Method: ${r.analysis.method}`,
            llmRationale: r.analysis.rationale,
            rank: r.rank,
          },
        })
      ),
      prisma.query.update({
        where: { id: queryRow.id },
        data: { status: "complete", completedAt: new Date() },
      }),
    ]);

    notify("done");
    return { queryId: queryRow.id, rankedPapers: confident, stats, searchStrategy };
  } catch (err) {
    await prisma.query.update({
      where: { id: queryRow.id },
      data: {
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}