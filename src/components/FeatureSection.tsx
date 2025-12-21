import { useState } from "react";
import { ChevronDown, ShieldCheck, ThumbsUp, AlertTriangle, HelpCircle } from "lucide-react";
import { PolicyFeature } from "@/lib/mockData";

type FeatureType = "great" | "good" | "bad" | "unclear";

interface FeatureSectionProps {
  type: FeatureType;
  features: PolicyFeature[];
  defaultOpen?: boolean;
}

const typeConfig = {
  great: {
    title: "Great Features",
    icon: ShieldCheck,
    bgClass: "bg-great",
    textClass: "text-great-foreground",
    contentBg: "bg-great/5",
    borderClass: "border-great/20",
  },
  good: {
    title: "Good Features",
    icon: ThumbsUp,
    bgClass: "bg-good",
    textClass: "text-good-foreground",
    contentBg: "bg-good/5",
    borderClass: "border-good/20",
  },
  bad: {
    title: "Red Flags",
    icon: AlertTriangle,
    bgClass: "bg-bad",
    textClass: "text-bad-foreground",
    contentBg: "bg-bad/5",
    borderClass: "border-bad/20",
  },
  unclear: {
    title: "Needs Clarification",
    icon: HelpCircle,
    bgClass: "bg-unclear",
    textClass: "text-unclear-foreground",
    contentBg: "bg-unclear/5",
    borderClass: "border-unclear/20",
  },
};

const FeatureSection = ({ type, features, defaultOpen = false }: FeatureSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = typeConfig[type];
  const Icon = config.icon;

  if (features.length === 0) return null;

  return (
    <div className="feature-section border border-border rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full ${config.bgClass} px-6 py-4 flex items-center justify-between transition-all duration-300`}
      >
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${config.textClass}`} />
          <span className={`font-body font-semibold ${config.textClass}`}>
            {config.title}
          </span>
          <span className={`${config.textClass}/80 font-body text-sm`}>
            ({features.length})
          </span>
        </div>
        <ChevronDown
          className={`w-5 h-5 ${config.textClass} transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className={`${config.contentBg} divide-y ${config.borderClass}`}>
          {features.map((feature, index) => (
            <div
              key={index}
              className="p-6 animate-fade-in"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <h4 className="font-body font-semibold text-foreground mb-3">
                {feature.name}
              </h4>
              
              <div className="mb-3">
                <span className="font-body text-sm text-muted-foreground">
                  Policy states:{" "}
                </span>
                <span className="font-body text-sm text-foreground italic">
                  "{feature.quote}"
                </span>
                <span className="font-body text-xs text-muted-foreground ml-2">
                  — {feature.reference}
                </span>
              </div>
              
              <div>
                <span className="font-body text-sm font-medium text-foreground">
                  What this means:{" "}
                </span>
                <span className="font-body text-sm text-muted-foreground">
                  {feature.explanation}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeatureSection;
