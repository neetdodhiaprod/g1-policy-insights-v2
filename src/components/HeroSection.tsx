interface HeroSectionProps {
  children: React.ReactNode;
}

const HeroSection = ({ children }: HeroSectionProps) => {
  return (
    <section className="hero-gradient min-h-screen pb-16">
      <div className="container mx-auto px-4 pt-12 pb-8 text-center">
        <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground mb-4 animate-fade-in">
          Policy Analyzer
        </h1>
        <p className="font-body text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in" style={{ animationDelay: '0.1s' }}>
          Upload your health insurance policy and get instant insights on what's great, good, and needs attention
        </p>
      </div>
      
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto animate-fade-in" style={{ animationDelay: '0.2s' }}>
          {children}
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
