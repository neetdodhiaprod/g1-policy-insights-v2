import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIG                                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
  version: "9.3.0",
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

const SYSTEM_PROMPT = `You are an expert analyst for Indian health insurance policies. Analyze thoroughly and categorize features accurately.

## MANDATORY WAITING PERIOD ANALYSIS
You MUST find and categorize these waiting periods in EVERY policy:

1. PED (Pre-Existing Disease) Waiting Period:
   - GREAT: No PED waiting OR ≤12 months (very rare)
   - GOOD: 24-36 months (IRDAI allows up to 36 months - this is market standard)
   - RED_FLAG: 48 months or longer

2. Specific Illness Waiting Period (for conditions like cataract, hernia, knee replacement, etc.):
   - GREAT: No specific illness waiting OR ≤12 months
   - GOOD: 24 months (market standard)
   - RED_FLAG: 36+ months

3. Initial Waiting Period:
   - GREAT: No initial waiting
   - GOOD: 30 days (industry norm)
   - RED_FLAG: >30 days

## CATEGORIZATION RULES

### GREAT (Best-in-class)
- Room Rent: No limit / "any room"
- No co-pay at any age
- Restore: Unlimited OR same illness covered
- Consumables: Fully covered
- Pre-hospitalization: ≥60 days
- Post-hospitalization: ≥180 days
- Modern treatments fully covered (AYUSH, robotic surgery)
- Worldwide emergency cover

### GOOD (Industry standard)
- Room Rent: Single private AC room
- Co-pay: Optional OR senior-only (60+)
- Restore: Different illness only
- Pre-hospitalization: 30-59 days
- Post-hospitalization: 60-179 days
- Day care: 140+ procedures

### RED_FLAG (Concerning)
- Room Rent: Daily cap OR proportionate deduction
- Co-pay: Mandatory for all ages
- No restore benefit
- Consumables: Not covered
- Sub-limits on common procedures
- Zone-based restrictions

## EXPLANATION FORMAT
Write explanations in 2-3 simple sentences with practical examples. Be conversational. DO NOT start with "What this means:" - just write the explanation directly.

Examples:
- GREAT: "You can choose any hospital room without worrying about deductions. Most policies cap room rent and reduce your entire claim proportionately if you exceed it."
- GOOD: "The 36-month PED waiting period is within IRDAI guidelines and is market standard. After 3 years, all your pre-existing conditions will be covered."
- RED_FLAG: "With a 48-month PED waiting period, claims for pre-existing conditions like diabetes or BP will be rejected for the first 4 years. This exceeds the typical 36-month market standard."

## CRITICAL RULES
1. ALWAYS evaluate and categorize PED waiting period
2. ALWAYS evaluate and categorize Specific Illness waiting period  
3. PED 24-36 months = GOOD (market standard)
4. PED 48+ months = RED_FLAG
5. Specific illness 24 months = GOOD
6. Specific illness 36+ months = RED_FLAG
7. Keep policyStates quotes SHORT (max 50 chars)
8. DO NOT prefix explanations with "What this means:" - the UI adds this automatically`;

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
