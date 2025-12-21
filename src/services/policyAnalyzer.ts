import { supabase } from '@/integrations/supabase/client';

export interface PolicyFeature {
  name: string;
  quote: string;
  reference: string;
  explanation: string;
}

export interface AnalysisResult {
  policyName: string;
  insurer: string;
  sumInsured: string;
  policyType: string;
  documentType: string;
  summary: {
    great: number;
    good: number;
    bad: number;
    unclear: number;
  };
  features: {
    great: PolicyFeature[];
    good: PolicyFeature[];
    bad: PolicyFeature[];
    unclear: PolicyFeature[];
  };
  disclaimer: string;
}

export class PolicyAnalysisError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'PolicyAnalysisError';
  }
}

export async function analyzePolicyWithAI(policyText: string): Promise<AnalysisResult> {
  console.log(`Sending policy text for analysis (${policyText.length} characters)`);

  const { data, error } = await supabase.functions.invoke('analyze-policy', {
    body: { policyText }
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new PolicyAnalysisError(error.message || 'Failed to analyze policy');
  }

  if (data?.error) {
    console.error('Analysis error:', data.error);
    throw new PolicyAnalysisError(data.error);
  }

  console.log('Analysis received:', data.policyName);
  return data as AnalysisResult;
}
