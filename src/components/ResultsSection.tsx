import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import SummaryCard from "./SummaryCard";
import FeatureSection from "./FeatureSection";
import { PolicyAnalysis } from "@/lib/mockData";

interface ResultsSectionProps {
  analysis: PolicyAnalysis;
  onReset: () => void;
}

const ResultsSection = ({ analysis, onReset }: ResultsSectionProps) => {
  const handleDownloadPDF = () => {
    // TODO: Implement PDF generation
    console.log("Downloading PDF report...");
  };

  return (
    <div className="animate-fade-in">
      <SummaryCard
        summary={analysis.summary}
        policyName={analysis.policyName}
        insurer={analysis.insurer}
      />

      <div className="bg-card rounded-2xl shadow-card p-6 md:p-8 mb-6">
        <h3 className="font-display text-xl text-foreground mb-6">
          Detailed Analysis
        </h3>

        <FeatureSection
          type="great"
          features={analysis.features.great}
          defaultOpen={true}
        />
        <FeatureSection
          type="good"
          features={analysis.features.good}
        />
        <FeatureSection
          type="bad"
          features={analysis.features.bad}
          defaultOpen={true}
        />
        <FeatureSection
          type="unclear"
          features={analysis.features.unclear}
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button
          onClick={handleDownloadPDF}
          size="lg"
          className="font-body font-semibold"
        >
          <Download className="w-4 h-4 mr-2" />
          Download PDF Report
        </Button>
        <Button
          onClick={onReset}
          variant="outline"
          size="lg"
          className="font-body font-semibold"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Analyze Another Policy
        </Button>
      </div>
    </div>
  );
};

export default ResultsSection;
