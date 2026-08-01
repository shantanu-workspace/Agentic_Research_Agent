import { z } from "zod";
import { groqJson } from "../groq";

const planSchema = z.object({
  coreConcepts: z.array(z.string()).min(1).max(6),
  searchPhrasings: z.array(z.string()).min(2).max(4),
});

export type QueryPlan = z.infer<typeof planSchema>;

const SYSTEM_PROMPT = `You are a research search-strategy planner. Given a user's research question or topic, \
you extract the core academic concepts and generate alternate search-engine phrasings that would surface \
relevant papers on OpenAlex. OpenAlex's search is keyword/title-driven, not conversational — \
so phrasings should read like paper titles or abstract fragments, not questions.

Respond ONLY with JSON matching this exact shape:
{
  "coreConcepts": string[],      // 2-6 short noun-phrase concepts, e.g. "retrieval-augmented generation"
  "searchPhrasings": string[]    // 2-4 distinct search strings, each 3-8 words, varying terminology/synonyms
}`;

/**
 * Step 1 of the pipeline. Turns a loose user query ("how do LLMs know when
 * they don't know something") into concrete search phrasings a paper-search
 * API can actually work with, plus the core concepts (used later for
 * relevance scoring context).
 */
export async function planQuery(rawQuery: string): Promise<QueryPlan> {
  return groqJson({
    system: SYSTEM_PROMPT,
    user: `Research question/topic: "${rawQuery}"`,
    schema: planSchema,
    temperature: 0.3,
    maxTokens: 400,
    label: "planQuery",
  });
}
