import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PolicyFeature {
  name: string;
  quote: string;
  reference: string;
  explanation: string;
}

interface PolicyAnalysis {
  policyName: string;
  insurerName: string;
  policyType: string;
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
}

const SYSTEM_PROMPT = `You are an expert insurance policy analyst. Your job is to analyze insurance policy documents and extract key features, categorizing them as great, good, bad, or unclear.

For each feature you identify, provide:
1. A clear name for the feature
2. A direct quote from the policy document
3. A reference (section/page if mentioned)
4. A brief explanation of why this is categorized this way

Categories:
- GREAT: Exceptional coverage, better than industry standard, customer-friendly terms
- GOOD: Standard acceptable coverage, meets expectations
- BAD: Poor coverage, restrictive terms, hidden limitations, unfavorable conditions
- UNCLEAR: Ambiguous language, missing information, terms that need clarification

You MUST respond with valid JSON matching this exact structure:
{
  "policyName": "Name of the policy",
  "insurerName": "Name of the insurance company",
  "policyType": "health|life|auto|home|other",
  "summary": {
    "great": <number of great features>,
    "good": <number of good features>,
    "bad": <number of bad features>,
    "unclear": <number of unclear features>
  },
  "features": {
    "great": [{"name": "", "quote": "", "reference": "", "explanation": ""}],
    "good": [{"name": "", "quote": "", "reference": "", "explanation": ""}],
    "bad": [{"name": "", "quote": "", "reference": "", "explanation": ""}],
    "unclear": [{"name": "", "quote": "", "reference": "", "explanation": ""}]
  }
}

Analyze thoroughly and be specific. Look for:
- Coverage limits and exclusions
- Waiting periods
- Claim procedures
- Premium terms
- Renewal conditions
- Pre-existing condition clauses
- Network restrictions
- Deductibles and co-pays
- Cancellation terms`;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { policyText } = await req.json();

    if (!policyText || typeof policyText !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Policy text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'API configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing policy text (${policyText.length} characters)`);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Please analyze this insurance policy document and provide a comprehensive assessment:\n\n${policyText}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to analyze policy' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Anthropic response received');

    // Extract the text content from Claude's response
    const textContent = data.content?.find((c: any) => c.type === 'text')?.text;
    
    if (!textContent) {
      console.error('No text content in response:', data);
      return new Response(
        JSON.stringify({ error: 'Invalid response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON from Claude's response
    let analysis: PolicyAnalysis;
    try {
      // Try to extract JSON from the response (Claude might include markdown code blocks)
      const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                        textContent.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : textContent;
      analysis = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse Claude response as JSON:', textContent);
      return new Response(
        JSON.stringify({ error: 'Failed to parse analysis results' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Analysis complete:', {
      policyName: analysis.policyName,
      summary: analysis.summary,
    });

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-policy function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
