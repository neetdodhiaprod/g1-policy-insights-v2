import { supabase } from "@/integrations/supabase/client";
import { PolicyAnalysis } from "@/lib/mockData";

export class PolicyAnalysisError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'PolicyAnalysisError';
  }
}

export async function analyzePolicyWithAI(policyText: string): Promise<PolicyAnalysis> {
  console.log(`Sending policy text for analysis (${policyText.length} characters)`);
  
  const { data, error } = await supabase.functions.invoke('analyze-policy', {
    body: { policyText },
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new PolicyAnalysisError(
      error.message || 'Failed to analyze policy',
      error.status
    );
  }

  if (data?.error) {
    console.error('Analysis error:', data.error);
    throw new PolicyAnalysisError(data.error);
  }

  if (!data?.analysis) {
    console.error('No analysis in response:', data);
    throw new PolicyAnalysisError('No analysis received from server');
  }

  console.log('Analysis received:', data.analysis.policyName);
  return data.analysis as PolicyAnalysis;
}
