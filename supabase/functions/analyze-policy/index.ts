import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIG                                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
  version: "8.0.0",
  // Claude Haiku: ~₹2-3 per analysis, reliable structured output
  model: "claude-3-5-haiku-20241022",
  maxTokens: 4096,
  temperature: 0.1,
  maxDocChars: 150000,  // ~37K tokens input, well within 200K context
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
// ║ THE PROMPT - Same structure that worked with Claude Sonnet                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const SYSTEM_PROMPT = `You are a health insurance policy analysis expert for Indian health insurance. Analyze the policy and return a JSON object.

## CATEGORIZATION RULES

### GREAT (Best-in-class)
- Room rent: No limit / any room
- PED waiting: ≤24 months
- Pre/post hospitalization: ≥60/180 days
- No co-pay
- Restore: Unlimited or same illness covered
- Consumables: Fully covered
- Modern treatments: No sub-limits

### GOOD (Industry standard)
- Room rent: Single private AC room
- PED waiting: 25-36 months
- Pre/post hospitalization: 30-59/60-179 days
- Co-pay: Optional or senior-only (60+)
- Restore: Different illness only
- Day care: 140+ procedures

### RED_FLAG (Concerning)
- Room rent: Daily cap OR proportionate deduction
- PED waiting: >36 months
- Pre/post hospitalization: <30/<60 days
- Co-pay: Mandatory for all ages
- No restore benefit
- Consumables: Not covered

### UNCLEAR
- Vague language needing clarification
- Conflicting statements
- Missing critical details

## IMPORTANT
1. Extract ALL red flags - never skip any
2. Show top 5-7 GREAT features
3. Show top 3-5 GOOD features
4. Discover UNIQUE features not in standard lists (wellness rewards, 2x cover, etc.)
5. Keep quotes SHORT (max 50 chars)
6. Write 1-sentence explanations in simple English

## OUTPUT FORMAT
Return ONLY valid JSON matching this exact structure:
{
  "policyName": "string",
  "insurer": "string", 
  "sumInsured": "string",
  "summary": { "great": number, "good": number, "redFlags": number, "unclear": number },
  "greatFeatures": [{ "name": "string", "policyStates": "string", "reference": "string", "explanation": "string" }],
  "goodFeatures": [{ "name": "string", "policyStates": "string", "reference": "string", "explanation": "string" }],
  "redFlags": [{ "name": "string", "policyStates": "string", "reference": "string", "explanation": "string" }],
  "needsClarification": [{ "name": "string", "policyStates": "string", "reference": "string", "explanation": "string" }],
  "disclaimer": "This analysis is for informational purposes only. Please verify with your insurer."
}`;

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CLAUDE API CALL                                                            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

async function analyzeWithClaude(apiKey: string, policyText: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs);

  try {
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
        messages: [{
          role: 'user',
          content: `Analyze this health insurance policy:\n\n${policyText}`
        }]
      })
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error ${response.status}: ${error.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;

    if (!text) {
      throw new Error('Empty response from Claude');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    if (text.includes('```json')) {
      jsonStr = text.split('```json')[1].split('```')[0];
    } else if (text.includes('```')) {
      jsonStr = text.split('```')[1].split('```')[0];
    }

    return JSON.parse(jsonStr.trim());

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

    // Get API key - try CLAUDE_API_KEY first, then ANTHROPIC_API_KEY
    const apiKey = Deno.env.get('CLAUDE_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Claude API key not configured. Add CLAUDE_API_KEY to environment variables." }),
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

    // Analyze with Claude
    console.log(`[${Date.now() - startTime}ms] Calling Claude ${CONFIG.model}`);
    const result = await analyzeWithClaude(apiKey, docText);
    console.log(`[${Date.now() - startTime}ms] Analysis complete`);

    // Ensure summary counts match arrays
    result.summary = {
      great: result.greatFeatures?.length || 0,
      good: result.goodFeatures?.length || 0,
      redFlags: result.redFlags?.length || 0,
      unclear: result.needsClarification?.length || 0
    };

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
    }

    return new Response(
      JSON.stringify({ error: userMessage, _debug: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
