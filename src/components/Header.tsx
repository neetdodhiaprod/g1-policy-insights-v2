import { Shield } from "lucide-react";

const Header = () => {
  return (
    <header className="bg-card border-b border-border sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl text-foreground">
              Guardian One
            </span>
          </div>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#" className="font-body text-sm text-muted-foreground hover:text-foreground transition-colors">
              Why Us
            </a>
            <a href="#" className="font-body text-sm text-muted-foreground hover:text-foreground transition-colors">
              Health Insurance 101
            </a>
            <a href="#" className="font-body text-sm text-muted-foreground hover:text-foreground transition-colors">
              Calculator
            </a>
            <a href="#" className="font-body text-sm text-muted-foreground hover:text-foreground transition-colors">
              Claims
            </a>
          </nav>

          {/* CTA Button */}
          <button className="bg-primary text-primary-foreground font-body font-semibold px-5 py-2.5 rounded-lg hover:bg-primary/90 transition-all duration-300 shadow-sm hover:shadow-md">
            Book a Free Call
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
