"use client";

import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { PipelineStage } from "@/lib/pipeline";

const STAGES: { key: PipelineStage; label: string }[] = [
  { key: "planning", label: "Planning search strategy" },
  { key: "searching", label: "Searching literature databases" },
  { key: "filtering", label: "Filtering candidates" },
  { key: "analyzing", label: "Reading & scoring papers" },
  { key: "ranking", label: "Ranking results" },
  { key: "confidence", label: "Discarding low-confidence matches" },
];

export function AgentSteps({
  currentStage,
  detail,
}: {
  currentStage: PipelineStage | null;
  detail?: string;
}) {
  const currentIndex = currentStage ? STAGES.findIndex((s) => s.key === currentStage) : -1;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
      {STAGES.map((stage, i) => {
        const isDone = currentIndex > i || currentStage === "done";
        const isActive = currentIndex === i && currentStage !== "done";

        return (
          <div key={stage.key} className="flex items-center gap-3">
            {isDone ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
            ) : isActive ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "text-sm",
                isDone && "text-foreground",
                isActive && "font-medium text-foreground",
                !isDone && !isActive && "text-muted-foreground/60"
              )}
            >
              {stage.label}
              {isActive && detail ? (
                <span className="ml-1.5 text-xs text-muted-foreground">({detail})</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}