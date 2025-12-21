import { useState } from "react";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import UploadSection from "@/components/UploadSection";
import LoadingState from "@/components/LoadingState";
import ResultsSection from "@/components/ResultsSection";
import Footer from "@/components/Footer";
import { mockAnalysisData, PolicyAnalysis } from "@/lib/mockData";

type AppState = "upload" | "loading" | "results";

const Index = () => {
  const [appState, setAppState] = useState<AppState>("upload");
  const [analysisResult, setAnalysisResult] = useState<PolicyAnalysis | null>(null);

  const handleAnalyze = async (file: File) => {
    console.log("Analyzing file:", file.name);
    setAppState("loading");

    // Simulate API call delay
    setTimeout(() => {
      // Using mock data for MVP
      setAnalysisResult(mockAnalysisData);
      setAppState("results");
    }, 3000);
  };

  const handleReset = () => {
    setAppState("upload");
    setAnalysisResult(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      
      <main className="flex-1">
        <HeroSection>
          {appState === "upload" && (
            <UploadSection
              onAnalyze={handleAnalyze}
              isLoading={false}
            />
          )}
          
          {appState === "loading" && <LoadingState />}
          
          {appState === "results" && analysisResult && (
            <ResultsSection
              analysis={analysisResult}
              onReset={handleReset}
            />
          )}
        </HeroSection>
      </main>

      <Footer />
    </div>
  );
};

export default Index;
