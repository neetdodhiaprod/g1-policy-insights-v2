import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Step 1: Document validation tool (uses minimal tokens)
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

// Step 2: Policy analysis tool (full analysis)
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

const analysisSystemPrompt = `You are a health insurance policy analysis expert for Indian health insurance policies. Your job is to THOROUGHLY analyze policies and find BOTH positives AND negatives.

═══════════════════════════════════════════════════════════════
STANDARD IRDAI EXCLUSIONS - DO NOT FLAG THESE AS RED FLAGS
═══════════════════════════════════════════════════════════════

These are STANDARD exclusions - DO NOT flag as red flags:
- Maternity (when not covered in base plan)
- Infertility / Sterility treatments
- Cosmetic / Plastic surgery (unless for reconstruction)
- Obesity / Weight control programs
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

═══════════════════════════════════════════════════════════════
🟩 GREAT (Best-in-class) - Features BETTER than market standard
═══════════════════════════════════════════════════════════════

Look for and flag these as GREAT:
- Room Rent: No limit / Any room allowed / No sub-limit
- PED Waiting: Less than 24 months (2 years)
- Specific Illness Waiting: Less than 24 months
- Initial Waiting: 0 days (no waiting period)
- Maternity Waiting: 9 months or less (when maternity IS covered)
- Maternity Amount: ₹75,000 or more (when covered)
- Restore/Recharge: Works for same illness / Unlimited restores
- Consumables: Fully covered with no cap
- Pre-hospitalization: 60 days or more
- Post-hospitalization: 180 days or more
- Co-pay: 0% for all ages including seniors
- Cashless Network: More than 10,000 hospitals
- Modern Treatments (AYUSH, Robotic surgery): Covered without sub-limits
- No Claim Bonus: More than 50% per year / Unlimited accumulation
- Air Ambulance: Covered with high limits (₹5L+)
- Organ Donor: Fully covered
- Domiciliary Treatment: Covered
- Global Coverage: Available for emergencies abroad
- Day Care Procedures: All covered without restrictions
- Mental Health: Covered beyond IRDAI minimum
- Bariatric Surgery: Covered
- Road Ambulance: Covered without cap

═══════════════════════════════════════════════════════════════
🟨 GOOD (Industry Standard) - Features that meet market norms
═══════════════════════════════════════════════════════════════

- Room Rent: Single AC private room allowed
- PED Waiting: 24-48 months (2-4 years) - THIS IS STANDARD
- Specific Illness Waiting: 24 months (2 years) - THIS IS STANDARD  
- Initial Waiting: 30 days - THIS IS STANDARD
- Maternity Waiting: 9-36 months (when covered)
- Maternity Amount: ₹25,000 - ₹74,999
- Restore Benefit: For unrelated illness only
- Consumables: Partially covered or with sub-limits
- Pre-hospitalization: 30-59 days
- Post-hospitalization: 60-179 days
- Co-pay: 10-20% for age 60+ only
- Cashless Network: 7,000-10,000 hospitals
- Modern Treatments: Covered with sub-limits
- No Claim Bonus: 10-50% per year

═══════════════════════════════════════════════════════════════
🟥 BAD (Red Flags) - ACTIVELY LOOK FOR THESE PROBLEMS
═══════════════════════════════════════════════════════════════

IMPORTANT: Do not skip this section. Actively search the document for:

1. ROOM RENT RESTRICTIONS:
   - Any daily room rent cap (₹3,000, ₹5,000, ₹10,000 per day = RED FLAG)
   - Room rent as % of sum insured = RED FLAG
   - "Proportionate deduction" if room exceeds limit = MAJOR RED FLAG
   - ICU limits lower than main room limit = RED FLAG

2. WAITING PERIODS (longer than standard):
   - PED waiting > 48 months (> 4 years) = RED FLAG
   - Specific illness waiting > 24 months = RED FLAG
   - Initial waiting > 30 days = RED FLAG

3. CO-PAYMENT CLAUSES:
   - Mandatory co-pay for ALL ages (not just seniors) = RED FLAG
   - Co-pay > 20% = RED FLAG
   - Zone-based co-pay (higher in metro cities) = RED FLAG
   - Co-pay on specific treatments = RED FLAG

4. SUB-LIMITS ON TREATMENTS:
   - Cataract surgery limits (e.g., ₹40,000 per eye) = RED FLAG
   - Knee replacement limits = RED FLAG
   - Hernia limits = RED FLAG
   - Any disease-wise sub-limits = RED FLAG

5. MISSING OR LIMITED COVERAGE:
   - Restore/Recharge benefit NOT available = RED FLAG
   - Consumables NOT covered = RED FLAG
   - Modern treatments (robotic surgery, etc.) NOT covered = RED FLAG
   - Ambulance cover with low caps (below ₹2,000) = RED FLAG

6. CLAIM RESTRICTIONS:
   - "Reasonable and customary" clauses = NEEDS CLARIFICATION
   - "At insurer's discretion" for key benefits = RED FLAG
   - Aggregate sub-limits on categories = RED FLAG

7. NETWORK RESTRICTIONS:
   - Cashless only at limited hospitals = RED FLAG
   - Zone-based restrictions = RED FLAG

═══════════════════════════════════════════════════════════════
🟡 NEEDS CLARIFICATION - STRICT RULES
═══════════════════════════════════════════════════════════════

ONLY flag as "Needs Clarification" when information is GENUINELY missing or vague.

DO NOT flag as "Needs Clarification":
- Room rent stated as "Single Private AC room" — this is clear, not ambiguous
- Room rent stated as "No capping" or "Any room" — this is clear
- Any clearly defined benefit with specific terms
- Standard policy language that is industry-accepted
- Your own speculation about what "might" be unclear
- Premium amounts (this is policy-specific)
- Claim settlement process details
- Standard IRDAI exclusions

ONLY flag when:
- Policy says "as per company discretion" without defining criteria
- Policy mentions a benefit but gives no limit or duration
- Policy has genuinely conflicting statements
- Critical information is actually missing from the document
- A coverage uses vague terms: "reasonable", "customary", "as decided by TPA"
- Waiting period mentioned but exact duration not specified

BAD EXAMPLE (do not do this):
Feature: "Single Private AC room"
Flagging as unclear because: "there might be rupee caps not mentioned"
→ WRONG. Do not speculate. If it says Single Private AC, that's the coverage.

GOOD EXAMPLE:
Feature: "Room rent as per eligibility"
Flagging as unclear because: "eligibility criteria not defined anywhere in document"
→ CORRECT. This is genuinely vague.

═══════════════════════════════════════════════════════════════
EXPLICIT CATEGORIZATION EXAMPLES
═══════════════════════════════════════════════════════════════

ROOM RENT:
- "No room rent limit" or "Any room" → GREAT
- "Single Private AC room" → GOOD (clear benefit, do NOT flag as unclear)
- "Room rent up to ₹5,000/day" → BAD
- "Room rent as per eligibility" (undefined) → NEEDS CLARIFICATION

PED WAITING PERIOD:
- Less than 24 months → GREAT
- 24 months (2 years) → GOOD
- 36 months (3 years) → GOOD
- 48 months (4 years) → GOOD
- More than 48 months → BAD

SPECIFIC ILLNESS WAITING:
- Less than 24 months → GREAT
- 24 months (2 years) → GOOD
- More than 24 months → BAD

RESTORE/RESET BENEFIT:
- "Unlimited reset for any illness including same illness" → GREAT
- "Reset for unrelated illness only" → GOOD
- "No reset benefit" → BAD

IMPORTANT RULES:
1. Do NOT speculate about hidden terms or caps
2. Do NOT create doubt where the policy language is clear
3. Only flag genuinely ambiguous or missing information
4. If a benefit is clearly stated, categorize it — don't flag as unclear
5. "Single Private AC Room" is NOT the same as "Any Room" — Single AC is GOOD
6. 36 months PED = 3 years = within 24-48 month range = GOOD (NOT a red flag)

═══════════════════════════════════════════════════════════════
ANALYSIS INSTRUCTIONS - READ CAREFULLY
═══════════════════════════════════════════════════════════════

1. READ THE ENTIRE DOCUMENT - Do not skim
2. For EACH category (GREAT, GOOD, BAD, UNCLEAR), aim for:
   - GREAT: 5-8 features that are better than market standard
   - GOOD: 3-5 features that meet market standard
   - BAD: ALL red flags found (do not minimize - if there are 10 red flags, list all 10)
   - UNCLEAR: Any genuinely vague or conflicting terms

3. For EACH feature found, provide:
   - name: Clear feature name
   - quote: EXACT text from the document (copy-paste)
   - reference: Section/page reference if available
   - explanation: Why this is great/good/bad/unclear

4. Common things to check:
   - Does policy have room rent limits? Check "Room Rent" section
   - Does policy have disease-wise sub-limits? Check "Sub-limits" or schedule
   - What are the waiting periods? Check "Waiting Period" section
   - Is there mandatory co-pay? Check "Co-payment" section
   - What's NOT covered? Check "Exclusions" section carefully
   - Are consumables covered? Check specifically for this

5. Add disclaimer: "Standard IRDAI exclusions apply. Please verify all details with your insurer."

Use the submit_policy_analysis tool to submit your findings.`;

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

    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Validate document type first (uses minimal tokens)
    // ═══════════════════════════════════════════════════════════════
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
            content: `Check if this is a health insurance document from India (policy wording, brochure, or policy schedule). 

A health insurance document will typically contain:
- Terms like "hospitalization", "sum insured", "cashless", "pre-existing disease", "waiting period", "room rent", "ICU"
- References to IRDAI (Insurance Regulatory and Development Authority of India)
- Medical expense coverage, in-patient treatment coverage

This is NOT a health insurance document if it's:
- Life insurance, motor insurance, travel insurance, home insurance
- Bank statement, invoice, resume, or any non-insurance document
- A document from outside India

Use the validate_document tool to submit your assessment.

Document text (first 2000 characters):

${policyText.substring(0, 2000)}`
          }
        ]
      }),
    });

    if (!validationResponse.ok) {
      const errorText = await validationResponse.text();
      console.error('Claude API validation error:', validationResponse.status, errorText);
      throw new Error(`Document validation failed: ${validationResponse.status}`);
    }

    const validationData = await validationResponse.json();
    console.log('Validation response received');

    // Extract validation result using Tools format
    const validationToolUse = validationData.content?.find((block: any) => block.type === 'tool_use');
    
    if (!validationToolUse || validationToolUse.type !== 'tool_use') {
      console.error('No tool use in validation response:', validationData.content);
      throw new Error('Document validation failed - invalid response format');
    }

    const validation = validationToolUse.input as {
      isHealthInsurance: boolean;
      documentType: string;
      reason: string;
    };

    console.log('Validation result:', validation);

    // If not a health insurance document, return error immediately
    if (!validation.isHealthInsurance) {
      console.log('Document rejected - not health insurance');
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

    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Full analysis (only if validation passed)
    // ═══════════════════════════════════════════════════════════════
    console.log('Step 2: Document validated, proceeding with full analysis...');
    
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
            content: `Analyze this health insurance policy document thoroughly and submit your analysis using the submit_policy_analysis tool:\n\n${policyText}`
          }
        ]
      }),
    });

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text();
      console.error('Claude API analysis error:', analysisResponse.status, errorText);
      throw new Error(`Policy analysis failed: ${analysisResponse.status}`);
    }

    const analysisData = await analysisResponse.json();
    console.log('Analysis response received, extracting tool use...');

    // Extract analysis result using Tools format
    const analysisToolUse = analysisData.content?.find((block: any) => block.type === 'tool_use');
    
    if (!analysisToolUse || analysisToolUse.type !== 'tool_use') {
      console.error('No tool use in analysis response:', analysisData.content);
      throw new Error('Policy analysis failed - invalid response format');
    }

    const analysisResult = analysisToolUse.input;
    console.log('Analysis complete:', {
      policyName: analysisResult.policyName,
      insurer: analysisResult.insurer,
      summary: analysisResult.summary,
      greatCount: analysisResult.features?.great?.length || 0,
      goodCount: analysisResult.features?.good?.length || 0,
      badCount: analysisResult.features?.bad?.length || 0,
      unclearCount: analysisResult.features?.unclear?.length || 0,
    });
    
    // Log red flags specifically for debugging
    if (analysisResult.features?.bad?.length > 0) {
      console.log('Red flags found:', analysisResult.features.bad.map((f: any) => f.name));
    } else {
      console.log('No red flags found - verify if policy genuinely has none');
    }
    
    // Log unclear items
    if (analysisResult.features?.unclear?.length > 0) {
      console.log('Unclear items:', analysisResult.features.unclear.map((f: any) => f.name));
    }

    return new Response(JSON.stringify(analysisToolUse.input), {
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
