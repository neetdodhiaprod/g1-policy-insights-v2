import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Document validation tool
const documentValidationTool = {
  name: "validate_document",
  description: "Validate if the uploaded document is a health insurance policy document from India",
  input_schema: {
    type: "object" as const,
    properties: {
      isHealthInsurance: {
        type: "boolean",
        description: "True if this is a health insurance policy, brochure, or policy wording document from India"
      },
      documentType: {
        type: "string",
        enum: ["Health Insurance Policy", "Health Insurance Brochure", "Policy Schedule", "Not Health Insurance"],
        description: "Type of document detected"
      },
      reason: {
        type: "string",
        description: "Brief explanation of why this is or isn't a health insurance document"
      }
    },
    required: ["isHealthInsurance", "documentType", "reason"]
  }
};

// Policy analysis tool
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

const analysisSystemPrompt = `You are a health insurance policy analysis expert for Indian health insurance policies.

═══════════════════════════════════════════════════════════════
CRITICAL RULES - READ FIRST
═══════════════════════════════════════════════════════════════

BEFORE you categorize ANY feature, check these rules:

1. PED WAITING PERIOD:
   - 12 months = GREAT
   - 24 months = GOOD
   - 36 months = GOOD (this is 3 years - STILL GOOD, NOT a red flag)
   - 48 months = GOOD (this is 4 years - STILL GOOD, NOT a red flag)
   - 60+ months = BAD (only flag if MORE than 48 months)

2. SPECIFIC ILLNESS WAITING:
   - 12 months = GREAT
   - 24 months = GOOD (standard)
   - 36+ months = BAD (only flag if MORE than 24 months)

3. ROOM RENT:
   - "Any room" / "No limit" / "No capping" = GREAT
   - "Single Private AC room" / "Single AC" = GOOD (NOT great)
   - Any rupee cap (₹3,000/day, ₹5,000/day, etc.) = BAD

4. INITIAL WAITING:
   - 0 days = GREAT
   - 30 days = GOOD (standard)
   - 31+ days = BAD

5. STANDARD EXCLUSIONS - NEVER FLAG:
   - Maternity (in base plan) = IGNORE
   - Infertility = IGNORE
   - Cosmetic surgery = IGNORE
   - All other standard IRDAI exclusions = IGNORE

═══════════════════════════════════════════════════════════════
OPTIONAL COVERS / ADD-ONS - IMPORTANT DISTINCTION
═══════════════════════════════════════════════════════════════

Many policies offer OPTIONAL covers where customers make a conscious trade-off.
These are NOT red flags - they are CHOICES that provide flexibility.

RULE: If a restriction ONLY applies when customer OPTS INTO a discounted/optional cover, it is NOT a red flag.

EXAMPLES:

1. Network Advantage / Preferred Provider Network:
   - "10% premium discount if you opt for Network Advantage"
   - "20% co-pay applies only if you go outside Preferred Provider Network"
   → This is GOOD (optional trade-off), NOT a red flag
   → Customer who doesn't want restriction simply doesn't opt for it

2. Co-pay Waiver Add-on:
   - "Base plan has 10% co-pay, but co-pay waiver available as add-on"
   → This is GOOD (flexibility offered)

3. Room Rent Upgrade:
   - "Base plan covers Single AC, upgrade to Any Room available"
   → Base plan is GOOD, upgrade option is GREAT

4. Zone-based Pricing:
   - "Zone A premium vs Zone B premium with different network access"
   → This is a pricing choice, not a restriction

HOW TO IDENTIFY OPTIONAL VS MANDATORY:

OPTIONAL (flag as GOOD or don't flag):
- "If the Insured Person has opted for this Optional Cover..."
- "Subject to the Insured Person choosing..."
- "Available as an add-on..."
- "Discount available if you choose..."
- Customer must actively select it

MANDATORY (may be RED FLAG):
- "Applicable on all claims..."
- "Co-payment shall be deducted..."
- "In all cases, the insured shall bear..."
- No opt-out mentioned
- Applies by default to all policyholders

═══════════════════════════════════════════════════════════════
STANDARD IRDAI EXCLUSIONS - DO NOT MENTION THESE
═══════════════════════════════════════════════════════════════

Do NOT flag these anywhere (not in red flags, not in needs clarification):
- Maternity (when not covered in base plan)
- Infertility / Sterility treatments
- Cosmetic / Plastic surgery
- Obesity / Weight control programs
- War / Nuclear / Terrorism
- Self-inflicted injuries
- Hazardous sports
- Breach of law
- Alcoholism / Drug abuse
- Unproven treatments
- Dental (unless accident)
- Spectacles / Hearing aids
- External congenital diseases
- HIV/AIDS
- Vaccination
- Vitamins / Tonics
- Investigation without diagnosis
- Rest cures
- Refractive error correction
- Change of gender

═══════════════════════════════════════════════════════════════
🟩 GREAT (Best-in-class)
═══════════════════════════════════════════════════════════════

Flag as GREAT only if BETTER than market standard:

| Feature | GREAT Threshold |
|---------|-----------------|
| Room Rent | "No limit" / "Any room" (NOT Single AC) |
| PED Waiting | Less than 24 months |
| Specific Illness | Less than 24 months |
| Initial Waiting | 0 days |
| Maternity Waiting | ≤9 months (when covered) |
| Maternity Amount | ≥₹75,000 |
| Restore Benefit | Same illness covered / Unlimited |
| Consumables | Fully covered, no cap |
| Pre-hospitalization | ≥60 days |
| Post-hospitalization | ≥180 days |
| Co-pay | 0% for all ages |
| Cashless Network | >10,000 hospitals |
| Modern Treatments | No sub-limits |
| NCB | >50% per year |
| Air Ambulance | Covered |
| Domiciliary | Covered |
| Bariatric Surgery | Covered |

═══════════════════════════════════════════════════════════════
🟨 GOOD (Industry Standard)
═══════════════════════════════════════════════════════════════

Flag as GOOD if meets market standard:

| Feature | GOOD Threshold |
|---------|----------------|
| Room Rent | Single Private AC room |
| PED Waiting | 24-48 months (2-4 years) |
| Specific Illness | 24 months |
| Initial Waiting | 30 days |
| Maternity Waiting | 9-36 months |
| Maternity Amount | ₹25,000-₹74,999 |
| Restore Benefit | Unrelated illness only |
| Consumables | Partially covered |
| Pre-hospitalization | 30-59 days |
| Post-hospitalization | 60-179 days |
| Co-pay | 10-20% for 60+ only |
| Cashless Network | 7,000-10,000 |
| Modern Treatments | With sub-limits |
| NCB | 10-50% per year |
| Optional Cover Trade-offs | Network Advantage, Zone discounts, etc. |

═══════════════════════════════════════════════════════════════
🟥 BAD (Red Flags) - BE CAREFUL
═══════════════════════════════════════════════════════════════

ONLY flag as BAD if WORSE than market standard:

| Feature | BAD Threshold |
|---------|---------------|
| Room Rent | Any daily cap (₹3K, ₹5K, ₹10K/day) |
| Proportionate Deduction | If present |
| PED Waiting | >48 months (more than 4 years) |
| Specific Illness | >24 months |
| Initial Waiting | >30 days |
| Restore Benefit | Not available |
| Consumables | Not covered |
| Pre-hospitalization | <30 days |
| Post-hospitalization | <60 days |
| Co-pay | >20% any age OR mandatory all ages (NOT optional covers) |
| Zone-based Co-pay | Only if MANDATORY (not if part of optional discount) |
| Cashless Network | <7,000 hospitals |
| Disease Sub-limits | Any (cataract ₹40K, etc.) |
| Non-standard Exclusions | Beyond IRDAI list |

DO NOT flag as BAD:
- 36 month PED (this is GOOD)
- 24 month specific illness (this is GOOD)
- Single AC room (this is GOOD)
- Standard IRDAI exclusions
- Co-pay in OPTIONAL covers (like Network Advantage)
- Restrictions that only apply if customer opts for a discount
- Network limitations in optional add-ons
- Trade-offs in add-on covers where customer gets a benefit in return
- Zone-based pricing options (these are choices, not restrictions)

═══════════════════════════════════════════════════════════════
EXPLICIT EXAMPLES FOR OPTIONAL VS MANDATORY
═══════════════════════════════════════════════════════════════

Example 1:
Policy says: "Network Advantage Optional Cover: 10% premium discount, 20% co-pay outside Preferred Provider Network"
→ Categorize as: GOOD
→ Explanation: "Optional feature offering premium savings. Co-pay only applies if you choose this option AND go outside network hospitals. You can skip this option for unrestricted access."

Example 2:
Policy says: "A co-payment of 20% shall be applicable on all claims"
→ Categorize as: BAD
→ Explanation: "Mandatory 20% co-pay on every claim reduces effective coverage."

Example 3:
Policy says: "Co-payment of 10% applicable for insured persons above 60 years"
→ Categorize as: GOOD (if 10-20%)
→ This is industry standard for senior citizens

Example 4:
Policy says: "Zone-based co-pay: 10% if treated outside your zone"
→ Categorize as: BAD (if mandatory)
→ Categorize as: GOOD (if part of optional discounted plan)

═══════════════════════════════════════════════════════════════
🟡 NEEDS CLARIFICATION
═══════════════════════════════════════════════════════════════

ONLY flag when GENUINELY unclear:
- "As per company discretion" without criteria
- Benefit mentioned but no limit specified
- Conflicting statements
- Vague terms: "reasonable", "customary", "as decided by TPA"

DO NOT flag:
- "Single Private AC room" - this is clear
- "No room rent limit" - this is clear
- Premium amounts
- Claim process details
- Standard IRDAI exclusions
- Your speculation about "possible" hidden terms
- Optional cover terms that are clearly explained

═══════════════════════════════════════════════════════════════
FINAL CHECKLIST - VERIFY BEFORE SUBMITTING
═══════════════════════════════════════════════════════════════

Before using submit_policy_analysis, verify:

☐ PED 24-48 months is in GOOD (not red flags)
☐ Specific illness 24 months is in GOOD (not red flags)
☐ Single AC room is in GOOD (not great)
☐ Initial 30 days is in GOOD (not red flags)
☐ NO standard IRDAI exclusions in red flags
☐ NO standard IRDAI exclusions in needs clarification
☐ NO speculation in needs clarification
☐ OPTIONAL cover trade-offs are in GOOD (not red flags)
☐ Only MANDATORY restrictions are considered for red flags
☐ Room rent with daily cap IS in red flags
☐ Proportionate deduction IS in red flags (if present)

═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════

1. GREAT: 5-8 features better than market
2. GOOD: 3-5 features meeting market standard
3. BAD: ALL genuine red flags (do not minimize)
4. UNCLEAR: Only genuinely vague items

For each feature provide:
- name: Clear feature name
- quote: EXACT text from document
- reference: Section/page if available
- explanation: Simple explanation for customer

Add disclaimer: "Standard IRDAI exclusions apply. Please verify all details with your insurer or policy document."

Now analyze the policy and submit using the tool.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { policyText } = await req.json();

    // Input validation
    const MIN_TEXT_LENGTH = 100;
    const MAX_TEXT_LENGTH = 500000; // ~500KB

    if (!policyText || policyText.trim().length < MIN_TEXT_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'Policy text is too short or empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (policyText.length > MAX_TEXT_LENGTH) {
      return new Response(
        JSON.stringify({ error: 'Policy text exceeds maximum allowed length of 500KB' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Analyzing policy text (${policyText.length} characters)`);

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      console.error('ANTHROPIC_API_KEY not configured');
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // STEP 1: Validate document type
    console.log('Step 1: Validating document type...');
    
    const validationResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        tools: [documentValidationTool],
        tool_choice: { type: "tool", name: "validate_document" },
        messages: [
          {
            role: 'user',
            content: `Check if this is a health insurance document from India.

Health insurance documents contain: hospitalization, sum insured, cashless, pre-existing disease, waiting period, room rent, ICU, IRDAI.

NOT health insurance: life insurance, motor insurance, travel insurance, bank statements, invoices, resumes, non-Indian documents.

Use validate_document tool.

Document (first 2000 chars):
${policyText.substring(0, 2000)}`
          }
        ]
      }),
    });

    if (!validationResponse.ok) {
      const errorText = await validationResponse.text();
      console.error('Validation error:', validationResponse.status, errorText);
      throw new Error(`Document validation failed: ${validationResponse.status}`);
    }

    const validationData = await validationResponse.json();
    const validationToolUse = validationData.content?.find((block: any) => block.type === 'tool_use');
    
    if (!validationToolUse || validationToolUse.type !== 'tool_use') {
      throw new Error('Document validation failed - invalid response format');
    }

    const validation = validationToolUse.input as {
      isHealthInsurance: boolean;
      documentType: string;
      reason: string;
    };

    console.log('Validation result:', validation);

    if (!validation.isHealthInsurance) {
      return new Response(
        JSON.stringify({ 
          error: 'invalid_document',
          message: `This doesn't appear to be a health insurance policy document. Detected: ${validation.documentType}. ${validation.reason}. Please upload a health insurance policy wording, brochure, or policy schedule.`,
          detectedType: validation.documentType
        }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // STEP 2: Full analysis
    console.log('Step 2: Running full analysis...');
    
    const analysisResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: analysisSystemPrompt,
        tools: [policyAnalysisTool],
        tool_choice: { type: "tool", name: "submit_policy_analysis" },
        messages: [
          {
            role: 'user',
            content: `Analyze this health insurance policy. Follow the CRITICAL RULES and FINAL CHECKLIST before submitting.

REMEMBER:
- 36 month PED = GOOD (not red flag)
- 24 month specific illness = GOOD (not red flag)
- Single AC room = GOOD (not great)
- Do NOT flag standard IRDAI exclusions

Policy document:
${policyText}`
          }
        ]
      }),
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      console.error('Analysis error:', analysisResponse.status, errorText);
      throw new Error(`Policy analysis failed: ${analysisResponse.status}`);
    }

    const analysisData = await analysisResponse.json();
    const analysisToolUse = analysisData.content?.find((block: any) => block.type === 'tool_use');
    
    if (!analysisToolUse || analysisToolUse.type !== 'tool_use') {
      throw new Error('Policy analysis failed - invalid response format');
    }

    const result = analysisToolUse.input;
    
    console.log('Analysis complete:', {
      policy: result.policyName,
      insurer: result.insurer,
      great: result.features?.great?.length || 0,
      good: result.features?.good?.length || 0,
      bad: result.features?.bad?.length || 0,
      unclear: result.features?.unclear?.length || 0,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error:', error);
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
