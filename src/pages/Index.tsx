import { useState } from "react";
import Header from "@/components/Header";
import HeroSection from "@/components/HeroSection";
import UploadSection from "@/components/UploadSection";
import LoadingState from "@/components/LoadingState";
import ResultsSection from "@/components/ResultsSection";
import Footer from "@/components/Footer";
import { PolicyAnalysis } from "@/lib/mockData";
import { extractTextFromPDF, PDFError } from "@/utils/pdfExtractor";
import { analyzePolicyWithAI, PolicyAnalysisError, InvalidDocumentError } from "@/services/policyAnalyzer";
import { useToast } from "@/hooks/use-toast";

type AppState = "upload" | "extracting" | "analyzing" | "results";

const Index = () => {
  const [appState, setAppState] = useState<AppState>("upload");
  const [analysisResult, setAnalysisResult] = useState<PolicyAnalysis | null>(null);
  const { toast } = useToast();

  const handleAnalyze = async (file: File) => {
    setAppState("extracting");

    try {
      // Extract text from PDF
      const extractedText = await extractTextFromPDF(file);

      // Move to analyzing state
      setAppState("analyzing");

      // Call the AI analysis edge function
      try {
        const result = await analyzePolicyWithAI(extractedText);
        setAnalysisResult(result);
        setAppState("results");
      } catch (analysisError) {
        if (analysisError instanceof InvalidDocumentError) {
          toast({
            variant: "destructive",
            title: "Invalid Document",
            description: analysisError.message,
          });
        } else if (analysisError instanceof PolicyAnalysisError) {
          toast({
            variant: "destructive",
            title: "Analysis Error",
            description: analysisError.message,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Analysis Failed",
            description: "Failed to analyze the policy. Please try again.",
          });
        }
        
        setAppState("upload");
      }

    } catch (error) {
      if (error instanceof PDFError) {
        toast({
          variant: "destructive",
          title: "PDF Error",
          description: error.message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: "An unexpected error occurred. Please try again.",
        });
      }
      
      setAppState("upload");
    }
  };

  const handleReset = () => {
    setAppState("upload");
    setAnalysisResult(null);
  };

  const isLoading = appState === "extracting" || appState === "analyzing";

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
          
          {isLoading && (
            <LoadingState stage={appState === "extracting" ? "extracting" : "analyzing"} />
          )}
          
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
