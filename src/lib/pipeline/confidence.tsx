/**
 * Confidence tiers, keyed off the LLM's relevanceScore (0-100) from
 * analyzePapers. This is the single source of truth for the thresholds —
 * the pipeline uses it to decide what to discard, the UI uses it to label
 * what's shown, so they can never drift out of sync.
 */
export const CONFIDENCE_THRESHOLDS = {
  excellent: 80,
  relevant: 60,
  somewhatRelevant: 40,
} as const;

/** Below this score, a paper is dropped rather than shown at a low tier. */
export const DISCARD_THRESHOLD = CONFIDENCE_THRESHOLDS.somewhatRelevant;

export type ConfidenceTier = "excellent" | "relevant" | "somewhat_relevant" | "discard";

export function confidenceTier(relevanceScore: number): ConfidenceTier {
  if (relevanceScore >= CONFIDENCE_THRESHOLDS.excellent) return "excellent";
  if (relevanceScore >= CONFIDENCE_THRESHOLDS.relevant) return "relevant";
  if (relevanceScore >= CONFIDENCE_THRESHOLDS.somewhatRelevant) return "somewhat_relevant";
  return "discard";
}

export const CONFIDENCE_LABELS: Record<Exclude<ConfidenceTier, "discard">, string> = {
  excellent: "Excellent match",
  relevant: "Relevant",
  somewhat_relevant: "Somewhat relevant",
};