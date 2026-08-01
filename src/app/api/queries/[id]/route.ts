import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Fetches a previously-run query and its cached ranked results.
 * Lets a search be revisited via a shareable URL (/results/[queryId]) without
 * re-running the pipeline (no repeat LLM cost).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const query = await prisma.query.findUnique({
    where: { id: params.id },
    include: {
      results: {
        orderBy: { rank: "asc" },
        include: { paper: true },
      },
    },
  });

  if (!query) {
    return NextResponse.json({ error: "Query not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: query.id,
    rawQuery: query.rawQuery,
    status: query.status,
    errorMessage: query.errorMessage,
    createdAt: query.createdAt,
    results: query.results.map((r: (typeof query.results)[number]) => ({
      rank: r.rank,
      relevanceScore: r.relevanceScore,
      qualityScore: r.qualityScore,
      finalScore: r.finalScore,
      llmSummary: r.llmSummary,
      llmRationale: r.llmRationale,
      paper: {
        id: r.paper.id,
        title: r.paper.title,
        abstract: r.paper.abstract,
        authors: r.paper.authors,
        year: r.paper.year,
        venue: r.paper.venue,
        citationCount: r.paper.citationCount,
        url: r.paper.url,
        tldr: r.paper.tldr,
      },
    })),
  });
}
