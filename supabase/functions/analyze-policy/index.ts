import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const policyAnalysisTool = {
  name: "submit_policy_analysis",
  description: "Submit the structured analysis of a health insurance policy document",
  input_schema: {
    type: "object" as const,
    properties: {
      policyName: { type: "string", description: "Name of the policy or 'Not specified'" },
      insurer: { type: "string", description: "Insurance company name or 'Not specified'" },
      sumInsured: { type: "string", description: "Sum insured amount or 'Not specified'" },
      policyType: { type: "string", enum: ["Individual", "Family Floater", "Not specified"] },
      documentType: { type: "string", enum: ["Policy Wording", "Brochure", "Policy Schedule", "Mixed"] },
      summary: {
        type: "object",
        properties: {
          great: { type: "number" },
          good: { type: "number" },
          bad: { type: "number" },
          unclear: { type: "number" }
        },
        required: ["great", "good", "bad", "unclear"]
      },
      features: {
        type: "object",
        properties: {
          great: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quote: { type: "string" },
                reference: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["name", "quote", "reference", "explanation"]
            }
          },
          good: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quote: { type: "string" },
                reference: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["name", "quote", "reference", "explanation"]
            }
          },
          bad: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quote: { type: "string" },
                reference: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["name", "quote", "reference", "explanation"]
            }
          },
          unclear: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                quote: { type: "string" },
                reference: { type: "string" },
                explanation: { type: "string" }
              },
              required: ["name", "quote", "reference", "explanation"]
            }
          }
        },
        required: ["great", "good", "bad", "unclear"]
      },
      disclaimer: { type: "string" }
    },
    required: ["policyName", "insurer", "sumInsured", "policyType", "documentType", "summary", "features", "disclaimer"]
  }
};

const systemPrompt = `You are a health insurance policy analysis expert specializing in evaluating Indian health insurance policies for consumers.

CATEGORIZATION FRAMEWORK:

🟩 GREAT (Best-in-class):
- No room rent limit / any room allowed
- Pre-existing disease (PED) waiting < 2 years
- Specific illness waiting < 2 years  
- No initial 30-day waiting
- Maternity waiting < 9 months, coverage ≥ ₹75,000
- Restore benefit works for same illness
- Consumables/non-medical expenses covered
- Pre-hospitalization ≥ 60 days, Post-hospitalization ≥ 180 days
- 0% co-pay for all ages, no zone-based co-pay
- Cashless network > 10,000 hospitals
- All modern treatments covered without caps

🟨 GOOD (Industry standard):
- PED waiting 2-3 years (this is standard, NOT bad)
- Specific illness waiting 2 years (this is standard, NOT bad)
- Standard 30-day initial waiting
- Single AC private room allowed
- 7,000-10,000 cashless hospitals
- 10% co-pay only for members > 60 years
- Maternity limit ₹25,000-₹74,999
- Pre-hospitalization 30-59 days, Post-hospitalization 60-179 days

🟥 BAD (Red flags):
- Room rent cap ₹3,000-₹6,000/day or proportionate deduction
- PED waiting > 3 years
- Specific illness waiting > 2 years
- Initial waiting > 30 days
- Maternity not covered OR > 3 years waiting
- Co-pay > 20% or mandatory for all ages
- Zone-based co-pay
- < 7,000 cashless hospitals
- No restore benefit or restore only for unrelated illness
- Diseases permanently excluded beyond IRDAI standard

🟡 NEEDS CLARIFICATION:
- Feature not mentioned in document
- Vague or ambiguous language
- Conflicting statements
- Missing critical details

RULES:
1. Show ALL bad features - never skip any red flag
2. Show top 5-7 great features
3. Show top 3-5 good features  
4. Show all items needing clarification
5. Only flag exclusions BEYOND standard IRDAI exclusions
6. Use professional English but explain terms simply
7. Include exact quotes from the document with page/section references

After analyzing, use the submit_policy_analysis tool to submit your structured findings.`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { policyText } = await req.json();

    if (!policyText || policyText.trim().length < 100) {
      throw new Error('Policy text is too short or empty');
    }

    console.log(`Analyzing policy text (${policyText.length} characters)`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    console.log('Calling Claude API with tools...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        tools: [policyAnalysisTool],
        tool_choice: { type: "tool", name: "submit_policy_analysis" },
        messages: [
          {
            role: 'user',
            content: `Analyze this health insurance policy document thoroughly and submit your analysis using the submit_policy_analysis tool:\n\n${policyText}`
          }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Claude response received, extracting tool use...');

    // Extract tool use response
    const toolUse = data.content?.find((block: any) => block.type === 'tool_use');
    
    if (!toolUse || toolUse.type !== 'tool_use') {
      console.error('No tool use in response:', data.content);
      throw new Error('Invalid response format from AI');
    }

    console.log('Analysis complete:', {
      policyName: toolUse.input.policyName,
      insurer: toolUse.input.insurer,
    });

    return new Response(JSON.stringify(toolUse.input), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in analyze-policy function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze policy';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
