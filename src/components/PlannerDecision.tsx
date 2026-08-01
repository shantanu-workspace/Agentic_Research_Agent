import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle2, XCircle } from "lucide-react";

const ALL_PROVIDERS: { id: string; label: string }[] = [
  { id: "openalex", label: "OpenAlex" },
  { id: "arxiv", label: "arXiv" },
];

export interface PlannerDecisionData {
  domain: string;
  providers: string[];
  reason: string;
}

/**
 * Surfaces the planner's routing decision as its own panel rather than a
 * one-line caption. Showing every available provider — checked if selected,
 * greyed out if not — makes it visible that the LLM actively chose to
 * exclude a provider, not just that it picked one from a list of one.
 */
export function PlannerDecision({ data }: { data: PlannerDecisionData }) {
  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-blue-900">
          <Brain className="h-4 w-4 text-blue-600" />
          Planner Decision
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-blue-900/70">Detected domain:</span>
          <Badge className="border-blue-300 bg-blue-100 text-blue-800" variant="outline">
            {data.domain}
          </Badge>
        </div>

        <div>
          <p className="mb-1 text-blue-900/70">Selected tools:</p>
          <ul className="flex flex-col gap-1">
            {ALL_PROVIDERS.map((p) => {
              const selected = data.providers.includes(p.id);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-2 ${
                    selected ? "text-blue-950" : "text-muted-foreground/50 line-through"
                  }`}
                >
                  {selected ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-muted-foreground/50" />
                  )}
                  {p.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="mb-1 text-blue-900/70">Reason:</p>
          <p className="leading-relaxed text-blue-950">{data.reason}</p>
        </div>
      </CardContent>
    </Card>
  );
}