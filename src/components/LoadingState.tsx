import { FileSearch } from "lucide-react";

const LoadingState = () => {
  return (
    <div className="bg-card rounded-2xl shadow-card p-12 text-center">
      <div className="flex flex-col items-center gap-6">
        <div className="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center relative">
          <FileSearch className="w-10 h-10 text-primary animate-pulse-subtle" />
          <div className="absolute inset-0 rounded-2xl border-2 border-primary/20 animate-ping" />
        </div>
        
        <div>
          <h3 className="font-display text-xl text-foreground mb-2">
            Analyzing your policy...
          </h3>
          <p className="font-body text-muted-foreground">
            We're reviewing the fine print so you don't have to
          </p>
        </div>

        <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary rounded-full animate-pulse"
            style={{ 
              width: '60%',
              animation: 'progressPulse 2s ease-in-out infinite'
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes progressPulse {
          0%, 100% { width: 30%; margin-left: 0; }
          50% { width: 60%; margin-left: 20%; }
        }
      `}</style>
    </div>
  );
};

export default LoadingState;
