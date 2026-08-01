import { NextRequest } from "next/server";
import { z } from "zod";
import { runPipeline, type PipelineProgress } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Pro allows up to 300s; Hobby caps at 60s for this route

const requestSchema = z.object({
  query: z.string().trim().min(3, "Query must be at least 3 characters").max(500),
});

/**
 * Streams Server-Sent Events so the frontend can render live "agent step" UI
 * (planning → searching → filtering → analyzing → ranking → done) instead of
 * a single opaque spinner for what can be a 10-20s pipeline run.
 *
 * Event format: each SSE `data:` line is a JSON object of shape
 * { type: "progress", stage, detail } | { type: "result", queryId, rankedPapers } | { type: "error", message }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? "Invalid request" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { query } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const onProgress = (p: PipelineProgress) => send({ type: "progress", ...p });

      try {
        const result = await runPipeline(query, onProgress);
        send({ type: "result", ...result });
      } catch (err) {
        console.error("[/api/search] pipeline error:", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Pipeline failed unexpectedly",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
