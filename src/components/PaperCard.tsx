import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { confidenceTier, CONFIDENCE_LABELS } from "@/lib/pipeline/confidence";

export interface PaperCardData {
  rank: number;
  relevanceScore: number;
  finalScore: number;
  llmSummary: string;
  llmRationale: string;
  paper: {
    id: string;
    title: string;
    authors: { name: string }[];
    year: number | null;
    venue: string | null;
    citationCount: number;
    url: string | null;
    source: string; // "openalex" | "arxiv"
  };
}

const SOURCE_NAMES: Record<string, string> = { openalex: "OpenAlex", arxiv: "arXiv" };

/**
 * `paper.source` records which provider API we queried (openalex vs. our own
 * arxiv client) — but OpenAlex's own index crawls and includes arXiv
 * preprints, so a paper fetched *via* OpenAlex can still have a venue like
 * "arXiv (Cornell University)". Showing "Source: OpenAlex" next to that venue
 * reads as a routing bug even though the routing was correct. What a reader
 * actually means by "source" is the paper's true origin, so prefer the venue
 * signal when it clearly says arXiv.
 */
function displaySource(paper: PaperCardData["paper"]): string {
  if (paper.venue && /arxiv/i.test(paper.venue)) return "arXiv";
  return SOURCE_NAMES[paper.source] ?? paper.source;
}

function relevanceVariant(score: number): "success" | "warning" | "outline" {
  const tier = confidenceTier(score);
  if (tier === "excellent") return "success";
  if (tier === "relevant") return "success";
  return "warning"; // "somewhat_relevant" — "discard" tier never reaches this card
}

function relevanceLabel(score: number): string {
  const tier = confidenceTier(score);
  const label = tier === "discard" ? "Below threshold" : CONFIDENCE_LABELS[tier];
  return `${label} · ${score}/100`;
}

export function PaperCard({ data }: { data: PaperCardData }) {
  const { paper } = data;
  const authorNames = paper.authors
    .slice(0, 3)
    .map((a) => a.name)
    .join(", ");
  const extraAuthors = paper.authors.length > 3 ? ` +${paper.authors.length - 3} more` : "";
  const sourceName = displaySource(paper);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">#{data.rank}</span>
            <span>·</span>
            <span>{paper.year ?? "n.d."}</span>
            {paper.venue && (
              <>
                <span>·</span>
                <span className="truncate">{paper.venue}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline">Source: {sourceName}</Badge>
            <Badge variant={relevanceVariant(data.relevanceScore)}>
              {relevanceLabel(data.relevanceScore)}
            </Badge>
          </div>
        </div>
        <CardTitle>
          {paper.url ? (
            <a
              href={paper.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1.5 hover:underline"
            >
              {paper.title}
              <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            paper.title
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {authorNames}
          {extraAuthors} · {paper.citationCount.toLocaleString()} citations
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why this paper?
          </p>
          <p className="text-sm leading-relaxed">{data.llmRationale}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">{data.llmSummary}</p>
        </div>
      </CardContent>
    </Card>
  );
}