import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const rejectDocumentTool = {
  name: "reject_document",
  description: "Reject the document if it is NOT a health insurance policy document",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: { type: "string", description: "Brief explanation of why this is not a health insurance policy" },
      detectedType: { type: "string", description: "What type of document this appears to be (e.g., 'Life Insurance Policy', 'Motor Insurance', 'Bank Statement', 'Resume', etc.)" }
    },
    required: ["reason", "detectedType"]
  }
};

const policyAnalysisTool = {
  name: "submit_policy_analysis",
  description: "Submit the structured analysis of a health insurance policy document. Only use this if the document IS a health insurance policy.",
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

const systemPrompt = `You are a health insurance policy analysis expert for Indian health insurance policies.

═══════════════════════════════════════════════════════════════
FIRST: VALIDATE DOCUMENT TYPE
═══════════════════════════════════════════════════════════════

Before analyzing, you MUST verify this is a HEALTH INSURANCE policy document.

REJECT the document using reject_document tool if it is:
- Life insurance policy
- Motor/vehicle insurance policy
- Travel insurance policy
- Home/property insurance policy
- Any other type of insurance (not health)
- Bank statement, resume, invoice, or any non-insurance document
- Critical illness-only policy (without hospitalization coverage)

ACCEPT and analyze using submit_policy_analysis ONLY if:
- It is a health insurance policy (mediclaim, health insurance, hospitalization policy)
- It covers medical expenses, hospitalization, treatments
- It mentions terms like: sum insured, hospitalization, cashless, pre-existing diseases, waiting period, room rent, etc.

If in doubt, look for these keywords that indicate health insurance:
✓ Hospitalization expenses
✓ In-patient treatment
✓ Cashless facility
✓ Pre-existing disease waiting period
✓ Room rent
✓ ICU charges
✓ Pre/post hospitalization
✓ Daycare procedures

═══════════════════════════════════════════════════════════════
STANDARD IRDAI EXCLUSIONS - DO NOT FLAG THESE AS RED FLAGS
═══════════════════════════════════════════════════════════════

The following are STANDARD exclusions across virtually ALL Indian health insurance policies.
DO NOT mention these in red flags. DO NOT mention these in needs clarification.
Only add a brief note at the end: "Standard IRDAI exclusions apply (maternity in base plan, infertility, cosmetic surgery, etc.)"

Standard exclusions to IGNORE:
- Maternity (when not covered in base plan - this is standard)
- Infertility / Sterility treatments
- Cosmetic / Plastic surgery (unless for reconstruction after accident)
- Obesity / Weight control
- War / Nuclear / Terrorism
- Self-inflicted injuries / Suicide attempt
- Hazardous sports / Adventure activities
- Breach of law / Criminal activity
- Alcoholism / Drug abuse / Substance abuse
- Unproven / Experimental treatments
- Dental (unless due to accident)
- Spectacles / Contact lenses / Hearing aids
- External congenital diseases
- HIV/AIDS (unless specifically covered)
- Vaccination (unless post-bite treatment)
- Vitamins / Tonics / Supplements
- Investigation without diagnosis
- Rest cures / Rehabilitation
- Refractive error correction (LASIK etc.)
- Change of gender
- Sleep apnea devices
- External durable equipment for home use

═══════════════════════════════════════════════════════════════
CATEGORIZATION RULES - FOLLOW EXACTLY
═══════════════════════════════════════════════════════════════

🟩 GREAT (Best-in-class) - Features BETTER than market standard:

| Feature | GREAT Threshold |
|---------|-----------------|
| Room Rent | No limit / Any room allowed |
| PED Waiting | Less than 24 months |
| Specific Illness Waiting | Less than 24 months |
| Initial Waiting | 0 days (no waiting) |
| Maternity Waiting | 9 months or less (when maternity IS covered) |
| Maternity Amount | ₹75,000 or more |
| Restore Benefit | Works for same illness |
| Consumables | Fully covered, no cap |
| Pre-hospitalization | 60 days or more |
| Post-hospitalization | 180 days or more |
| Co-pay | 0% for all ages |
| Cashless Network | More than 10,000 hospitals |
| Modern Treatments | Covered without sub-limits |
| No Claim Bonus | More than 50% per year |
| Air Ambulance | Covered |
| Organ Donor | Fully covered |

🟨 GOOD (Industry Standard) - Features that meet market norms:

| Feature | GOOD Threshold |
|---------|----------------|
| Room Rent | Single AC private room |
| PED Waiting | 24-48 months (2-4 years) - THIS IS NORMAL |
| Specific Illness Waiting | 24 months (2 years) - THIS IS NORMAL |
| Initial Waiting | 30 days - THIS IS NORMAL |
| Maternity Waiting | 9-36 months (when covered) |
| Maternity Amount | ₹25,000 - ₹74,999 |
| Restore Benefit | For unrelated illness only |
| Consumables | Partially covered |
| Pre-hospitalization | 30-59 days |
| Post-hospitalization | 60-179 days |
| Co-pay | 10-20% for age 60+ only |
| Cashless Network | 7,000-10,000 hospitals |
| Modern Treatments | Covered with sub-limits |
| No Claim Bonus | 10-50% cumulative |

🟥 BAD (Red Flags) - Features WORSE than market standard:

ONLY flag these as red flags. Be very careful - do not over-flag.

| Feature | BAD Threshold |
|---------|---------------|
| Room Rent | Any daily cap like ₹3,000-₹10,000 per day |
| Proportionate Deduction | If present (expenses reduced if room limit exceeded) |
| PED Waiting | More than 48 months (more than 4 years) |
| Specific Illness Waiting | More than 24 months |
| Initial Waiting | More than 30 days |
| Restore Benefit | Not available at all |
| Consumables | Not covered at all |
| Pre-hospitalization | Less than 30 days |
| Post-hospitalization | Less than 60 days |
| Co-pay | More than 20% for any age |
| Co-pay | Mandatory for all ages (not just seniors) |
| Zone-based Co-pay | If present |
| Cashless Network | Less than 7,000 hospitals |
| Disease Sub-limits | Caps on specific diseases (e.g., cataract ₹40K) |
| Non-standard Exclusions | Any exclusion NOT in the standard IRDAI list above |

🟡 NEEDS CLARIFICATION - Missing or vague information:

Flag ONLY when:
- A critical coverage feature uses vague language like "at company's discretion"
- Waiting period mentioned but exact duration not specified
- Coverage mentioned but amount/limit not specified
- Conflicting statements in different sections

NEVER flag these as needing clarification:
- Premium amounts / pricing
- Sum insured options
- Claim settlement process
- Documents required for claims
- Customer service details
- Any standard IRDAI exclusion

═══════════════════════════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════════════════════════

1. Show ALL genuine red flags (but only if they meet BAD thresholds above)
2. Show top 5-7 GREAT features
3. Show top 3-5 GOOD features
4. Show items needing clarification (only if genuinely vague/missing)
5. Add disclaimer: "Standard IRDAI exclusions apply. Please verify all details with your insurer or policy document."

IMPORTANT EXAMPLES:

Example 1: "36 month PED waiting period"
→ This is 3 years, which is between 24-48 months
→ Categorize as: GOOD (not red flag)

Example 2: "24 month specific illness waiting"
→ This is exactly 24 months, which is standard
→ Categorize as: GOOD (not red flag)

Example 3: "Maternity excluded" in a base health policy
→ This is a standard IRDAI exclusion
→ DO NOT flag as red flag
→ Only mention in disclaimer: "Standard exclusions apply including maternity"

Example 4: "60 month PED waiting period"
→ This is 5 years, which exceeds 48 months
→ Categorize as: BAD (red flag)

Example 5: "Room rent limit ₹5,000 per day"
→ This is a daily cap
→ Categorize as: BAD (red flag)

Example 6: "Infertility treatment not covered"
→ This is a standard IRDAI exclusion
→ DO NOT mention at all, or only in disclaimer

═══════════════════════════════════════════════════════════════
FINAL CHECKLIST BEFORE SUBMITTING ANALYSIS
═══════════════════════════════════════════════════════════════

Before using the submit_policy_analysis tool, verify:
☐ No standard IRDAI exclusions in red flags
☐ No standard IRDAI exclusions in needs clarification
☐ PED 24-48 months is marked GOOD, not BAD
☐ Specific illness 24 months is marked GOOD, not BAD
☐ Initial waiting 30 days is marked GOOD, not BAD
☐ Maternity exclusion (in base plan) is NOT flagged
☐ Only genuine red flags that are WORSE than market standard are flagged

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
        tools: [rejectDocumentTool, policyAnalysisTool],
        tool_choice: { type: "any" },
        messages: [
          {
            role: 'user',
            content: `First, verify if this is a health insurance policy document. If it is NOT a health insurance policy (e.g., life insurance, motor insurance, travel insurance, or any non-insurance document), use the reject_document tool. If it IS a health insurance policy, analyze it thoroughly and submit your analysis using the submit_policy_analysis tool:\n\n${policyText}`
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

    // Check if document was rejected
    if (toolUse.name === 'reject_document') {
      console.log('Document rejected:', toolUse.input);
      return new Response(
        JSON.stringify({ 
          error: 'invalid_document',
          message: `This does not appear to be a health insurance policy. Detected: ${toolUse.input.detectedType}. ${toolUse.input.reason}`,
          detectedType: toolUse.input.detectedType
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
