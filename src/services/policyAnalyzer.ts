import { supabase } from '@/integrations/supabase/client';
import { PolicyFeature, PolicyAnalysis } from '@/lib/mockData';

// Re-export types for consumers
export type { PolicyFeature, PolicyAnalysis as AnalysisResult };

export class PolicyAnalysisError extends Error {
  constructor(
    message: string, 
    public statusCode?: number,
    public errorType?: string
  ) {
    super(message);
    this.name = 'PolicyAnalysisError';
  }
}

export class InvalidDocumentError extends PolicyAnalysisError {
  constructor(message: string, public detectedType?: string) {
    super(message, 400, 'invalid_document');
    this.name = 'InvalidDocumentError';
  }
}

export async function analyzePolicyWithAI(policyText: string): Promise<PolicyAnalysis> {
  console.log(`Sending policy text for analysis (${policyText.length} characters)`);

  const { data, error } = await supabase.functions.invoke('analyze-policy', {
    body: { policyText }
  });

  if (error) {
    console.error('Edge function error:', error);
    throw new PolicyAnalysisError(error.message || 'Failed to analyze policy');
  }

  if (data?.error) {
    console.error('Analysis error:', data.error, data.message);
    
    if (data.error === 'invalid_document') {
      throw new InvalidDocumentError(
        data.message || 'This does not appear to be a health insurance policy.',
        data.detectedType
      );
    }
    
    throw new PolicyAnalysisError(data.error);
  }

  console.log('Analysis received:', data.policyName);
  
  const transformFeature = (f: any): PolicyFeature => ({
    name: f.name || '',
    quote: f.policyStates || f.quote || '',
    reference: f.reference || '',
    explanation: f.explanation || ''
  });

  const result: PolicyAnalysis = {
    policyName: data.policyName || 'Unknown Policy',
    insurer: data.insurer || 'Unknown',
    sumInsured: data.sumInsured || 'Not specified',
    policyType: data.policyType || 'Not specified',
    documentType: 'Policy Wording',
    summary: {
      great: data.summary?.great || 0,
      good: data.summary?.good || 0,
      bad: data.summary?.redFlags || 0,
      unclear: data.summary?.unclear || 0
    },
    features: {
      great: (data.greatFeatures || []).map(transformFeature),
      good: (data.goodFeatures || []).map(transformFeature),
      bad: (data.redFlags || []).map(transformFeature),
      unclear: (data.needsClarification || []).map(transformFeature)
    },
    disclaimer: data.disclaimer || 'This analysis is for informational purposes only.'
  };

  return result;
}
