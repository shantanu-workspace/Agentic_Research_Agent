import { z } from "zod";
import { groqJson } from "../groq";
import { mapWithConcurrency } from "../utils";
import type { RawPaper } from "../openAlex";
import type { QueryPlan } from "./planQuery";

const analysisSchema = z.object({
  contribution: z.string().min(10),
  method: z.string().min(5),
  relevanceScore: z.number().int().min(0).max(100),
  rationale: z.string().min(10),
});

export type PaperAnalysis = z.infer<typeof analysisSchema>;

export interface AnalyzedPaper {
  paper: RawPaper;
  analysis: PaperAnalysis;
}

const SYSTEM_PROMPT = `You are a research assistant that reads a paper's title and abstract and evaluates it \
against a specific research question. Be precise and skeptical — do not inflate relevance scores for papers \
that are only tangentially related.

Respond ONLY with JSON matching this exact shape:
{
  "contribution": string,    // 1-2 sentences: what this paper actually contributes/found, in plain language
  "method": string,          // 1 sentence: the core method/approach used
  "relevanceScore": number,  // 0-100, how relevant this paper is to the user's specific research question
  "rationale": string        // 1-2 sentences explaining the relevanceScore — be specific about why
}

Scoring guide: 90-100 = directly addresses the question / foundational work on it. 60-89 = substantially \
related, covers a key sub-aspect. 30-59 = tangentially related, shares a concept but different focus. \
0-29 = weak or coincidental keyword overlap only.`;

function buildUserPrompt(rawQuery: string, coreConcepts: string[], paper: RawPaper): string {
  return `Research question: "${rawQuery}"
Core concepts being investigated: ${coreConcepts.join(", ")}

Paper title: ${paper.title}
Paper year: ${paper.year ?? "unknown"}
Paper abstract: ${paper.abstract}
${paper.tldr?.text ? `Existing TLDR (for reference, write your own contribution summary independently): ${paper.tldr.text}` : ""}`;
}

/**
 * Step 4. For each surviving candidate, ask Groq to extract the contribution
 * and method, and score relevance to the specific research question (not
 * relevance to the topic in general — the query itself matters).
 * Runs with bounded concurrency to stay within Groq's rate limits while
 * still being fast (25 papers sequentially would be too slow for a UI wait).
 */
export async function analyzePapers(
  rawQuery: string,
  plan: QueryPlan,
  papers: RawPaper[],
  concurrency = 5
): Promise<AnalyzedPaper[]> {
  const results = await mapWithConcurrency(papers, concurrency, async (paper) => {
    try {
      const analysis = await groqJson({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(rawQuery, plan.coreConcepts, paper),
        schema: analysisSchema,
        temperature: 0.15,
        maxTokens: 400,
        label: `analyzePapers:${paper.paperId}`,
      });
      return { paper, analysis };
    } catch (err) {
      console.error(`[analyzePapers] failed for paper ${paper.paperId}:`, err);
      return null;
    }
  });

  return results.filter((r): r is AnalyzedPaper => r !== null);
}
