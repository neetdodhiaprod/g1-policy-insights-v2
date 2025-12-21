import { ShieldCheck, ThumbsUp, AlertTriangle, HelpCircle } from "lucide-react";

interface SummaryCardProps {
  summary: {
    great: number;
    good: number;
    bad: number;
    unclear: number;
  };
  policyName: string;
  insurer: string;
}

const SummaryCard = ({ summary, policyName, insurer }: SummaryCardProps) => {
  return (
    <div className="bg-card rounded-2xl shadow-card p-6 md:p-8 mb-6">
      <div className="mb-6">
        <h2 className="font-display text-2xl text-foreground mb-1">
          {policyName}
        </h2>
        <p className="font-body text-muted-foreground">{insurer}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-great/10 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-great rounded-lg flex items-center justify-center mx-auto mb-2">
            <ShieldCheck className="w-5 h-5 text-great-foreground" />
          </div>
          <p className="font-display text-2xl text-great">{summary.great}</p>
          <p className="font-body text-sm text-muted-foreground">Great</p>
        </div>

        <div className="bg-good/10 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-good rounded-lg flex items-center justify-center mx-auto mb-2">
            <ThumbsUp className="w-5 h-5 text-good-foreground" />
          </div>
          <p className="font-display text-2xl text-good-foreground">{summary.good}</p>
          <p className="font-body text-sm text-muted-foreground">Good</p>
        </div>

        <div className="bg-bad/10 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-bad rounded-lg flex items-center justify-center mx-auto mb-2">
            <AlertTriangle className="w-5 h-5 text-bad-foreground" />
          </div>
          <p className="font-display text-2xl text-bad">{summary.bad}</p>
          <p className="font-body text-sm text-muted-foreground">Red Flags</p>
        </div>

        <div className="bg-unclear/10 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-unclear rounded-lg flex items-center justify-center mx-auto mb-2">
            <HelpCircle className="w-5 h-5 text-unclear-foreground" />
          </div>
          <p className="font-display text-2xl text-unclear">{summary.unclear}</p>
          <p className="font-body text-sm text-muted-foreground">Unclear</p>
        </div>
      </div>
    </div>
  );
};

export default SummaryCard;
