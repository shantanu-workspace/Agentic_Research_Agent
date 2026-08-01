import { z } from "zod";
import { groqJson } from "../groq";

const planSchema = z.object({
  coreConcepts: z.array(z.string()).min(1).max(6),
  searchPhrasings: z.array(z.string()).min(2).max(4),
  providers: z.array(z.enum(["openalex", "arxiv"])).min(1).max(2),
  providerReason: z.string().min(10),
});

export type QueryPlan = z.infer<typeof planSchema>;

const SYSTEM_PROMPT = `You are the planning agent for an academic research assistant.

Given a user's research question, perform three tasks:

1. Extract the core academic concepts.
2. Generate 2–4 academic search phrasings suitable for keyword-based literature search.
3. Select the most appropriate academic search providers.

Provider selection rules (follow strictly):

• "openalex"
  - Broad academic search engine covering nearly every discipline.
  - Use for medicine, biology, chemistry, economics, psychology, education, law, humanities, business, environmental science, and interdisciplinary topics.

• "arxiv"
  - Preprint repository focused on Computer Science, Artificial Intelligence, Machine Learning, Robotics, Mathematics, Statistics and Physics.
  - Do NOT use for medicine, biology, economics, humanities, or other non-CS domains.

Routing rules:

1. If the topic is primarily AI, Machine Learning, Computer Science, NLP, Computer Vision, Robotics, Statistics, Mathematics, or Physics:
   → select BOTH ["openalex","arxiv"].

2. Otherwise:
   → select ONLY ["openalex"].

Never select arXiv unless the topic clearly belongs to its supported research areas.

Respond ONLY as JSON:

{
  "coreConcepts": string[],
  "searchPhrasings": string[],
  "providers": ["openalex"] | ["openalex","arxiv"],
  "providerReason": string
}`;

/**
 * Step 1 of the pipeline. Turns a loose user query ("how do LLMs know when
 * they don't know something") into concrete search phrasings a paper-search
 * API can actually work with, plus the core concepts (used later for
 * relevance scoring context) and a provider selection with a human-readable
 * reason (surfaced in the UI as "Search strategy: ...").
 */
export async function planQuery(rawQuery: string): Promise<QueryPlan> {
  return groqJson({
    system: SYSTEM_PROMPT,
    user: `Research question/topic: "${rawQuery}"`,
    schema: planSchema,
    temperature: 0.3,
    maxTokens: 500,
    label: "planQuery",
  });
}