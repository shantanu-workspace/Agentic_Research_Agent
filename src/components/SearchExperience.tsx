"use client";

import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentSteps } from "@/components/AgentSteps";
import { PaperCard, type PaperCardData } from "@/components/PaperCard";
import { PlannerDecision, type PlannerDecisionData } from "@/components/PlannerDecision";
import { Loader2, Search } from "lucide-react";
import type { PipelineStage } from "@/lib/pipeline";

const EXAMPLE_QUERIES = [
  "How do large language models handle in-context learning?",
  "Retrieval-augmented generation for reducing hallucination",
  "Efficient fine-tuning methods for transformers (LoRA and beyond)",
];

interface RankedPaperResponse {
  paper: {
    paperId: string;
    title: string;
    authors: { name: string }[];
    year: number | null;
    venue: string | null;
    citationCount: number;
    url: string | null;
    source: string;
  };
  analysis: { relevanceScore: number; rationale: string; contribution: string; method: string };
  finalScore: number;
  rank: number;
}

interface PipelineStats {
  papersSearched: number;
  papersAnalyzed: number;
  papersPassed: number;
}

export function SearchExperience() {
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [detail, setDetail] = useState<string | undefined>();
  const [results, setResults] = useState<PaperCardData[] | null>(null);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [strategy, setStrategy] = useState<PlannerDecisionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function runSearch(q: string) {
    if (!q.trim() || isRunning) return;

    setIsRunning(true);
    setResults(null);
    setStats(null);
    setStrategy(null);
    setError(null);
    setStage(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          const parsed = JSON.parse(jsonStr);

          if (parsed.type === "progress") {
            setStage(parsed.stage);
            setDetail(parsed.detail);
          } else if (parsed.type === "result") {
            const ranked: RankedPaperResponse[] = parsed.rankedPapers;
            setStats(parsed.stats ?? null);
            setStrategy(
              parsed.searchStrategy
                ? {
                    domain: parsed.searchStrategy.domain,
                    providers: parsed.searchStrategy.providers,
                    reason: parsed.searchStrategy.reason,
                  }
                : null
            );
            setResults(
              ranked.map((r) => ({
                rank: r.rank,
                relevanceScore: r.analysis.relevanceScore,
                finalScore: r.finalScore,
                llmSummary: `${r.analysis.contribution} Method: ${r.analysis.method}`,
                llmRationale: r.analysis.rationale,
                paper: {
                  id: r.paper.paperId,
                  title: r.paper.title,
                  authors: r.paper.authors,
                  year: r.paper.year,
                  venue: r.paper.venue,
                  citationCount: r.paper.citationCount,
                  url: r.paper.url,
                  source: r.paper.source,
                },
              }))
            );
          } else if (parsed.type === "error") {
            setError(parsed.message);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Research Assistant Agent</h1>
        <p className="mt-2 text-muted-foreground">
          Ask a research question. The agent finds papers, reads them, and ranks what matters most.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(query);
        }}
        className="flex gap-2"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. How do LLMs handle in-context learning?"
          disabled={isRunning}
        />
        <Button type="submit" disabled={isRunning || query.trim().length < 3}>
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-2">Search</span>
        </Button>
      </form>

      {!isRunning && !results && !error && (
        <div className="flex flex-wrap justify-center gap-2">
          {EXAMPLE_QUERIES.map((eq) => (
            <button
              key={eq}
              onClick={() => {
                setQuery(eq);
                runSearch(eq);
              }}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {eq}
            </button>
          ))}
        </div>
      )}

      {isRunning && <AgentSteps currentStage={stage} detail={detail} />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Search failed</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {!isRunning && strategy && <PlannerDecision data={strategy} />}

      {results && results.length === 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          {stats ? (
            <>
              I searched {stats.papersSearched} papers and shortlisted the top{" "}
              {stats.papersAnalyzed} for detailed analysis — none strongly matched this question.
              Try rephrasing with more specific terminology.
            </>
          ) : (
            "No relevant papers found. Try rephrasing your question with more specific terminology."
          )}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {stats ? (
              <>
                I searched {stats.papersSearched} papers, shortlisted the top{" "}
                {stats.papersAnalyzed} for detailed analysis, and found{" "}
                <span className="font-medium text-foreground">{results.length}</span> that
                strongly matched your query.
              </>
            ) : (
              <>Found {results.length} relevant papers, ranked by relevance, citation impact, and recency.</>
            )}
          </p>
          {results.map((r) => (
            <PaperCard key={r.paper.id} data={r} />
          ))}
        </div>
      )}
    </div>
  );
}