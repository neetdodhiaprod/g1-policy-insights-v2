import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIG                                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
  version: "9.0.0",
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
      greatFeatures: {
        type: "array",
        description: "5-7 best-in-class features that exceed industry standards",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Feature name (e.g., 'No Room Rent Limit')" },
            policyStates: { type: "string", description: "Short quote from policy, max 50 characters" },
            reference: { type: "string", description: "Section or page reference" },
            explanation: { type: "string", description: "2-3 sentence explanation of why this benefits the policyholder, with practical examples" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      },
      goodFeatures: {
        type: "array",
        description: "3-5 features that meet industry standards",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            policyStates: { type: "string" },
            reference: { type: "string" },
            explanation: { type: "string", description: "2-3 sentence explanation of what this means for the policyholder" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      },
      redFlags: {
        type: "array",
        description: "ALL concerning clauses or limitations - never skip any",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            policyStates: { type: "string" },
            reference: { type: "string" },
            explanation: { type: "string", description: "2-3 sentence explanation of the financial/practical impact and what could go wrong during a claim" }
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
            explanation: { type: "string", description: "2-3 sentences explaining what's unclear and what specific question to ask the insurer" }
          },
          required: ["name", "policyStates", "explanation"]
        }
      }
    },
    required: ["policyName", "insurer", "sumInsured", "greatFeatures", "goodFeatures", "redFlags", "needsClarification"]
  }
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ SYSTEM PROMPT - Expert analysis with corrected logic                       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const SYSTEM_PROMPT = `You are an expert analyst for Indian health insurance policies. Your job is to thoroughly analyze policy documents and categorize features accurately.

## CATEGORIZATION RULES

### GREAT (Best-in-class - rare, premium policies)
- Room Rent: No limit / "any room" / no sub-limit
- PED Waiting: No PED waiting OR ≤12 months (very rare, exceptional)
- Specific Illness Waiting: No waiting OR ≤12 months
- Initial Waiting: No initial waiting period
- Pre-hospitalization: ≥60 days
- Post-hospitalization: ≥180 days
- No co-pay at any age
- Restore: Unlimited OR same illness covered
- Consumables: Fully covered with no sub-limits
- Modern treatments: AYUSH, robotic surgery, gene therapy fully covered
- No disease-wise sub-limits
- Worldwide emergency cover

### GOOD (Industry standard - most quality policies)
- Room Rent: Single private AC room
- PED Waiting: 24 months (IRDAI standard - this is the norm)
- Specific Illness Waiting: 24 months
- Initial Waiting: 30 days
- Pre-hospitalization: 30-59 days
- Post-hospitalization: 60-179 days
- Co-pay: Optional OR only for senior citizens (60+)
- Restore: Different illness only
- Day care: 140+ procedures covered

### RED_FLAG (Concerning - potential claim issues)
- Room Rent: Daily cap (₹X/day) OR proportionate deduction
- PED Waiting: 36 months, 48 months, or longer (worse than IRDAI standard)
- Specific Illness Waiting: 36+ months
- Initial Waiting: >30 days
- Pre-hospitalization: <30 days
- Post-hospitalization: <60 days
- Co-pay: Mandatory for all ages
- No restore/recharge benefit
- Consumables: Not covered or capped
- Sub-limits on common procedures (cataract, knee replacement, etc.)
- Zone-based restrictions reducing coverage
- Mandatory deductibles

### UNCLEAR (Needs clarification)
- Vague language ("as per company norms", "reasonable expenses")
- Conflicting statements in different sections
- Missing critical coverage details
- Ambiguous exclusion clauses

## EXPLANATION GUIDELINES

Write explanations that a non-expert can understand. Use 2-3 sentences.

For GREAT features:
- Explain what this means during an actual claim
- Compare to what typical/worse policies offer
- Example: "During hospitalization, you can choose any room including suites without worrying about deductions. Most policies cap room rent at ₹5,000-8,000/day and deduct proportionately from your entire bill if you exceed it."

For RED FLAGS:
- Explain the actual financial impact
- Describe what could go wrong during a claim
- Example: "With a 48-month PED waiting period, if you have diabetes and get hospitalized in year 2 or 3, your entire claim will be rejected. The IRDAI standard is 24 months, so this policy makes you wait twice as long."

For UNCLEAR items:
- Explain what information is missing or confusing
- Suggest a specific question to ask the insurer
- Example: "The policy mentions 'reasonable ambulance charges' without specifying a limit. Ask your insurer: 'What is the maximum ambulance reimbursement amount, and does it cover air ambulance?'"

## IMPORTANT RULES
1. Extract ALL red flags - never skip concerning clauses
2. PED waiting of 24 months is GOOD (industry standard), not GREAT
3. PED waiting of 36+ months is a RED FLAG
4. Discover UNIQUE features (wellness rewards, OPD cover, mental health, etc.)
5. Keep policyStates quotes SHORT (max 50 characters)
6. Always include practical examples in explanations`;

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
          content: `Analyze this Indian health insurance policy document thoroughly:\n\n${policyText}`
        }]
      })
    });

    clearTimeout(timeout);

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
