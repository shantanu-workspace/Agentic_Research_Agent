import Groq from "groq-sdk";
import { z } from "zod";
import { withRetry } from "./utils";

let _client: Groq | null = null;

function getClient(): Groq {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set. Add it to your .env file.");
  }
  if (!_client) {
    _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _client;
}

// llama-3.3-70b-versatile was deprecated by Groq (announced June 17, 2026,
// decommissioned Aug 16, 2026 for free/developer tier). openai/gpt-oss-120b
// is Groq's own recommended replacement: a 120B MoE model, still supports the
// { type: "json_object" } JSON mode we rely on (their newer json_schema mode
// has open bugs on this model as of writing — json_object is the safe choice).
export const GROQ_MODEL = "openai/gpt-oss-120b";

export async function groqJson<T>(params: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  label?: string;
}): Promise<T> {
  const { system, user, schema, temperature = 0.2, maxTokens = 1024, label = "groq call" } = params;

  return withRetry(
    async () => {
      const completion = await getClient().chat.completions.create({
        model: GROQ_MODEL,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // gpt-oss models emit chain-of-thought "reasoning" tokens before the
        // final answer by default (reasoning_effort defaults to "medium"),
        // which silently eats into the same per-minute token budget as the
        // JSON output itself. Our task is a bounded scoring/extraction job,
        // not open-ended reasoning, so "low" cuts token usage substantially
        // without hurting output quality — worth it twice over now that
        // rate-limit headroom is the whole point of this change.
        reasoning_effort: "low",
        // Without this, gpt-oss models can interleave chain-of-thought text
        // into message.content, which breaks JSON.parse below. "hidden"
        // keeps reasoning out of the returned content entirely.
        reasoning_format: "hidden",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error("Groq returned empty content");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Groq returned non-JSON content: ${raw.slice(0, 200)}`);
      }

      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Groq JSON failed schema validation: ${result.error.message}. Raw: ${raw.slice(0, 300)}`
        );
      }

      return result.data;
    },
    { label, retries: 2, baseDelayMs: 700 }
  );
}
