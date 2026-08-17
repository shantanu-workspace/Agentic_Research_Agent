import { z } from "zod";
import { groqJson } from "../groq";
import type { RawPaper } from "../openAlex";
import type { QueryPlan } from "./planQuery";

export interface PaperAnalysis {
  contribution: string;
  method: string;
  relevanceScore: number;
  rationale: string;
}

export interface AnalyzedPaper {
  paper: RawPaper;
  analysis: PaperAnalysis;
}

const MAX_ABSTRACT_CHARS = 700;

const batchSchema = z.object({
  results: z
    .array(
      z.object({
        paper: z.string(),
        contribution: z.string().min(10),
        method: z.string().min(5),
        relevanceScore: z.number().int().min(0).max(100),
        rationale: z.string().min(10),
      })
    )
    .min(1),
});

const SYSTEM_PROMPT = `You are a research assistant that evaluates a batch of candidate papers against one \
specific research question, in a single pass. For EVERY paper listed, output one analysis object — never \
skip a paper, and never merge two papers into one entry. Be precise and skeptical; do not inflate relevance \
scores for papers that are only tangentially related.

Respond ONLY with JSON matching this exact shape:
{
  "results": [
    {
      "paper": string,          // the paper's label exactly as given, e.g. "P1"
      "contribution": string,   // 1-2 sentences: what this paper actually contributes/found
      "method": string,         // 1 sentence: the core method/approach used
      "relevanceScore": number, // 0-100, relevance to the SPECIFIC research question below
      "rationale": string       // 1-2 sentences explaining the score
    }
  ]
}

Scoring guide: 90-100 = directly addresses the question / foundational work on it. 60-89 = substantially \
related, covers a key sub-aspect. 30-59 = tangentially related, shares a concept but different focus. \
0-29 = weak or coincidental keyword overlap only.`;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim() + "…";
}

function buildUserPrompt(rawQuery: string, coreConcepts: string[], papers: RawPaper[]): string {
  const paperBlocks = papers
    .map(
      (p, i) =>
        `P${i + 1}. "${p.title}" (${p.year ?? "n.d."})\nAbstract: ${truncate(p.abstract ?? "", MAX_ABSTRACT_CHARS)}`
    )
    .join("\n\n");

  return `Research question: "${rawQuery}"
Core concepts being investigated: ${coreConcepts.join(", ")}

Evaluate ALL ${papers.length} papers below. Return exactly ${papers.length} entries in "results", one per paper, labeled P1 through P${papers.length}.

${paperBlocks}`;
}

/**
 * Step 4 — rewritten to analyze the ENTIRE candidate batch in a single Groq
 * call instead of one call per paper. This is the fix for Groq free-tier
 * TPM (tokens-per-minute) rate limits: N concurrent per-paper calls at
 * ~700-900 tokens each blew through a 12k TPM budget once N got past ~10-15,
 * whereas one batched call covering the same N papers is roughly the same
 * total token volume but doesn't get throttled by per-request pacing the
 * way concurrent small requests do.
 *
 * Trade-off: a failed/invalid batch call loses the whole batch, not just one
 * paper — mitigated by keeping the candidate count small (see
 * MAX_CANDIDATES_TO_ANALYZE in pipeline/index.ts) and by groqJson's built-in
 * retry. If the model returns fewer entries than papers sent, the missing
 * ones are just dropped (logged) rather than failing the whole search.
 */
export async function analyzePapers(
  rawQuery: string,
  plan: QueryPlan,
  papers: RawPaper[]
): Promise<AnalyzedPaper[]> {
  if (papers.length === 0) return [];

  const batch = await groqJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(rawQuery, plan.coreConcepts, papers),
    schema: batchSchema,
    temperature: 0.15,
    // Scales with batch size instead of a flat per-paper cap, since this is
    // now one call covering all of them; comfortably covers gpt-oss-120b's
    // reasoning + JSON output for up to ~12 papers per batch.
    maxTokens: Math.min(4000, 250 * papers.length + 400),
    label: `analyzePapers:batch(${papers.length})`,
  });

  const byLabel = new Map(batch.results.map((r) => [r.paper.trim().toUpperCase(), r]));

  const analyzed: AnalyzedPaper[] = [];
  papers.forEach((paper, i) => {
    const label = `P${i + 1}`;
    const match = byLabel.get(label);
    if (!match) {
      console.warn(
        `[analyzePapers] batch response missing entry for ${label} ("${paper.title}") — dropping it from results`
      );
      return;
    }
    analyzed.push({
      paper,
      analysis: {
        contribution: match.contribution,
        method: match.method,
        relevanceScore: match.relevanceScore,
        rationale: match.rationale,
      },
    });
  });

  return analyzed;
}