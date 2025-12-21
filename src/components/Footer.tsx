import { Shield } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-card border-t border-border py-8">
      <div className="container mx-auto px-4 text-center">
        <p className="font-body text-xs text-muted-foreground mb-4 max-w-2xl mx-auto">
          Disclaimer: This analysis is for informational purposes only and does not constitute financial or insurance advice. 
          Always read your policy documents carefully and consult with a licensed insurance advisor for specific guidance.
        </p>
        
        <div className="flex items-center justify-center gap-2">
          <span className="font-body text-sm text-muted-foreground">Powered by</span>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 bg-primary rounded flex items-center justify-center">
              <Shield className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="font-display text-sm text-foreground">Guardian One</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
