import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIG                                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
  version: "9.5.0",
  model: "claude-3-5-haiku-20241022",
  maxTokens: 4096,
  temperature: 0.1,
  maxDocChars: 150000,
  timeoutMs: 60000
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ VALIDATION                                                                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function validateDocument(text: string): { valid: boolean; error?: string } {
  if (!text || text.length < 500) {
    return { valid: false, error: "Document too short. Please upload complete policy." };
  }
  
  const lower = text.substring(0, 10000).toLowerCase();
  const healthKeywords = ['health insurance', 'hospitalization', 'sum insured', 'cashless', 'waiting period', 'room rent', 'co-pay', 'irdai', 'claim'];
  const matches = healthKeywords.filter(k => lower.includes(k)).length;
  
  if (matches < 3) {
    return { valid: false, error: "This doesn't appear to be a health insurance policy." };
  }
  
  return { valid: true };
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ TOOL SCHEMA - Guarantees structured JSON output                            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const ANALYSIS_TOOL = {
  name: "submit_policy_analysis",
  description: "Submit the structured analysis of an Indian health insurance policy document",
  input_schema: {
    type: "object",
    properties: {
      policyName: { 
        type: "string", 
        description: "Full name of the insurance policy" 
      },
      insurer: { 
        type: "string", 
        description: "Name of the insurance company" 
      },
      sumInsured: { 
        type: "string", 
        description: "Coverage amount (e.g., '₹5 Lakhs', '₹1 Crore')" 
      },
      policyType: {
        type: "string",
        description: "Type of policy (e.g., 'Individual', 'Family Floater', 'Top-up')"
      },
      greatFeatures: {
        type: "array",
        description: "5-7 best-in-class features that exceed industry standards",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Feature name (e.g., 'No Room Rent Limit')" },
            policyStates: { type: "string", description: "Short quote from policy, max 50 characters" },
            reference: { type: "string", description: "Section or page reference" },
            explanation: { type: "string", description: "2-3 sentence explanation with practical examples" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      },
      goodFeatures: {
        type: "array",
        description: "3-5 features that meet industry standards. MUST include PED waiting period if 24 months.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            policyStates: { type: "string" },
            reference: { type: "string" },
            explanation: { type: "string", description: "2-3 sentence explanation" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      },
      redFlags: {
        type: "array",
        description: "ALL concerning clauses. MUST include PED waiting if 36+ months, Specific illness waiting if 36+ months.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            policyStates: { type: "string" },
            reference: { type: "string" },
            explanation: { type: "string", description: "2-3 sentences on financial/practical impact" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      },
      needsClarification: {
        type: "array",
        description: "Vague terms, conflicting statements, or missing details",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            policyStates: { type: "string" },
            reference: { type: "string" },
            explanation: { type: "string", description: "What's unclear and what question to ask" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      }
    },
    required: ["policyName", "insurer", "sumInsured", "policyType", "greatFeatures", "goodFeatures", "redFlags", "needsClarification"]
  }
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ SYSTEM PROMPT - Expert analysis with corrected logic                       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const SYSTEM_PROMPT = `You are an expert Indian health insurance policy analyzer.

══════════════════════════════════════════════════════════════
CLASSIFICATION RULES - FOLLOW EXACTLY
══════════════════════════════════════════════════════════════

WAITING PERIODS:
| Type              | GREAT      | GOOD         | RED FLAG    |
|-------------------|------------|--------------|-------------|
| PED               | ≤12 months | 24-48 months | >48 months  |
| Specific Illness  | ≤12 months | 24 months    | >24 months  |
| Initial           | 0 days     | 30 days      | >30 days    |

ROOM RENT:
| Term                              | Category |
|-----------------------------------|----------|
| "At Actuals" / "No limit"         | GREAT    |
| "Single Private AC"               | GOOD     |
| Daily cap (₹3K-₹10K/day)          | RED FLAG |
| Proportionate deduction clause    | RED FLAG |

PRE/POST HOSPITALIZATION:
| Pre-hosp    | Post-hosp   | Category |
|-------------|-------------|----------|
| ≥60 days    | ≥180 days   | GREAT    |
| 30-59 days  | 60-179 days | GOOD     |
| <30 days    | <60 days    | RED FLAG |

══════════════════════════════════════════════════════════════
GREAT FEATURES (Better than market)
══════════════════════════════════════════════════════════════
- Room rent at actuals/no limit
- Pre-hosp ≥60 days, Post-hosp ≥180 days
- Restore/Reset: Unlimited or same illness covered
- Consumables fully covered (Protect Benefit)
- 2X/3X/4X coverage multipliers
- Auto SI increase regardless of claims
- Air ambulance, No co-pay any age
- No geography-based co-pay
- Worldwide cover, Lifelong renewal

══════════════════════════════════════════════════════════════
GOOD FEATURES (Market standard)
══════════════════════════════════════════════════════════════
- Room rent: Single Private AC
- PED: 24-48 months (incl. 36 months)
- Specific illness: 24 months
- Initial waiting: 30 days
- Pre-hosp: 30-59 days, Post-hosp: 60-179 days
- Restore for different illness only
- Co-pay 10-20% for 60+ only
- AYUSH, Day care, Domiciliary covered
- Ambulance, Health check-up, Donor expenses
- Cashless network, Optional add-ons
- Daily cash for shared room (any amount)
- Voluntary deductible with discount

══════════════════════════════════════════════════════════════
RED FLAGS (Must flag if present)
══════════════════════════════════════════════════════════════
- Proportionate deduction clause
- Room rent daily cap in rupees
- PED >48 months, Specific illness >24 months
- Mandatory co-pay ALL ages
- Disease sub-limits (name exact disease + limit)
- PPN/Network co-pay penalty (10-20% outside network)
- No restore benefit, Consumables not covered

══════════════════════════════════════════════════════════════
NEVER FLAG AS RED FLAG
══════════════════════════════════════════════════════════════
- 24-month specific illness (GOOD)
- 36-month PED (GOOD)
- 48-month PED (GOOD)
- "Multiple exclusions" (lazy - not allowed)
- Daily cash benefit (BONUS = GOOD)
- Standard IRDAI exclusions
- Voluntary deductible options

STANDARD IRDAI EXCLUSIONS (never mention):
Cosmetic, Obesity, Infertility, Maternity (base), Dental, 
Spectacles, Vitamins, Self-harm, War, Hazardous sports, 
Alcohol/drugs, Experimental, Vaccination, Rest cures

══════════════════════════════════════════════════════════════
UNCLEAR (Only if genuinely vague)
══════════════════════════════════════════════════════════════
- Conflicting statements
- Benefit without details
- "Company discretion" without criteria

NOT unclear: Waiting periods, room rent terms, add-ons with prices

══════════════════════════════════════════════════════════════
OUTPUT
══════════════════════════════════════════════════════════════
- GREAT: 5-10 features
- GOOD: 5-10 features  
- RED FLAGS: All genuine issues (specific only)
- UNCLEAR: Only vague items

Each feature needs: name, quote (<100 chars), reference, explanation (1-2 sentences, use "you/your")

══════════════════════════════════════════════════════════════
MUST INCLUDE (if in policy)
══════════════════════════════════════════════════════════════
Room rent, PED waiting, Specific illness waiting, Initial waiting,
Pre/Post hospitalization, Restore benefit, Cashless network,
Proportionate deduction (if present), Co-pay terms (if any)

══════════════════════════════════════════════════════════════
CHECKLIST BEFORE SUBMIT
══════════════════════════════════════════════════════════════
□ 24-month specific illness in GOOD
□ 36/48-month PED in GOOD
□ Pre/Post ≥60/180 in GREAT
□ Proportionate deduction in RED FLAG (if exists)
□ No "multiple exclusions" anywhere
□ No IRDAI exclusions mentioned
□ Counts match actual features`;

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CLAUDE API CALL WITH TOOL USE                                              ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

async function analyzeWithClaude(apiKey: string, policyText: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  try {
    console.log(`Calling Claude with Tool Use API...`);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        temperature: CONFIG.temperature,
        system: SYSTEM_PROMPT,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: "tool", name: "submit_policy_analysis" },
        messages: [{
          role: 'user',
          content: `Analyze this health insurance policy.

REMEMBER:
- 24-month specific illness = GOOD
- 36-month PED = GOOD
- Proportionate deduction = RED FLAG (if present)
- Pre/Post ≥60/180 days = GREAT

MUST FLAG AS RED FLAG (if present in policy):
- Proportionate deduction - search for "proportional share" or "proportionate"
- Room rent daily cap - search for "₹" + "/day" or "per day"

Policy:
${policyText}`
        }]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Claude API error: ${response.status}`, error.substring(0, 500));
      throw new Error(`Claude API error ${response.status}: ${error.substring(0, 200)}`);
    }

    const data = await response.json();
    console.log(`Claude response received, content blocks: ${data.content?.length || 0}`);
    
    // Find the tool_use block in the response
    const toolUseBlock = data.content?.find((block: any) => block.type === 'tool_use');
    
    if (!toolUseBlock) {
      console.error('No tool_use block found in response:', JSON.stringify(data.content?.map((c: any) => c.type)));
      throw new Error('Claude did not return tool use response');
    }
    
    if (toolUseBlock.name !== 'submit_policy_analysis') {
      console.error(`Unexpected tool: ${toolUseBlock.name}`);
      throw new Error(`Unexpected tool response: ${toolUseBlock.name}`);
    }
    
    // The input is already a parsed object - no JSON parsing needed!
    const result = toolUseBlock.input;
    
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid tool input structure');
    }
    
    console.log(`Tool use extracted: ${result.policyName}, ${result.greatFeatures?.length || 0} great, ${result.redFlags?.length || 0} red flags`);
    
    return result;

  } finally {
    clearTimeout(timeout);
  }
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ MAIN HANDLER                                                               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

serve(async (req) => {
  const startTime = Date.now();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { policyText } = await req.json();
    console.log(`[${Date.now() - startTime}ms] Received ${policyText?.length || 0} chars`);

    if (!policyText) {
      return new Response(
        JSON.stringify({ error: "No policy text provided" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get API key
    const apiKey = Deno.env.get('CLAUDE_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Claude API key not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate document
    const validation = validateDocument(policyText);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    console.log(`[${Date.now() - startTime}ms] Validation passed`);

    // Truncate if needed
    const docText = policyText.length > CONFIG.maxDocChars 
      ? policyText.substring(0, CONFIG.maxDocChars) + "\n\n[Document truncated]"
      : policyText;
    console.log(`[${Date.now() - startTime}ms] Using ${docText.length} chars`);

    // Analyze with Claude Tool Use
    console.log(`[${Date.now() - startTime}ms] Calling Claude ${CONFIG.model} with Tool Use`);
    const result = await analyzeWithClaude(apiKey, docText);
    console.log(`[${Date.now() - startTime}ms] Analysis complete`);

    // Build summary from arrays
    result.summary = {
      great: result.greatFeatures?.length || 0,
      good: result.goodFeatures?.length || 0,
      redFlags: result.redFlags?.length || 0,
      unclear: result.needsClarification?.length || 0
    };

    // Add disclaimer if not present
    if (!result.disclaimer) {
      result.disclaimer = "This analysis is for informational purposes only. Please verify details with your insurer before making decisions.";
    }

    // Add metadata
    result._meta = {
      version: CONFIG.version,
      model: CONFIG.model,
      processingTimeMs: Date.now() - startTime
    };

    console.log(`[${Date.now() - startTime}ms] Done - ${result.summary.great}G ${result.summary.good}OK ${result.summary.redFlags}RF ${result.summary.unclear}?`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    
    let userMessage = "Analysis failed. Please try again.";
    if (error.message?.includes('API key')) {
      userMessage = "API key error. Please check configuration.";
    } else if (error.message?.includes('timeout') || error.message?.includes('abort')) {
      userMessage = "Analysis timed out. Please try again.";
    } else if (error.message?.includes('tool')) {
      userMessage = "Analysis parsing error. Please try again.";
    }

    return new Response(
      JSON.stringify({ error: userMessage, _debug: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
