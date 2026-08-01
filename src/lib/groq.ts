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

export const GROQ_MODEL = "llama-3.3-70b-versatile";

/**
 * Call Groq in JSON mode and validate the response against a zod schema.
 * Retries on: network errors, non-JSON responses, and schema validation failures
 * (the model occasionally drops a field — a retry with the same prompt usually fixes it).
 */
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
