import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VERSION = "7.0.0";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

function log(step: string, msg: string, start: number) {
  console.log(`[${Date.now() - start}ms] [${step}] ${msg}`);
}

// Validate health insurance document
function validateDocument(text: string): { valid: boolean; error?: string } {
  if (text.length < 500) {
    return { valid: false, error: "Document too short." };
  }
  const lower = text.substring(0, 10000).toLowerCase();
  const healthKeywords = ['hospitalization', 'sum insured', 'cashless', 'pre-existing', 'waiting period', 'irdai', 'health insurance', 'claim'];
  const hits = healthKeywords.filter(kw => lower.includes(kw));
  if (hits.length < 3) {
    return { valid: false, error: "Not a health insurance policy document." };
  }
  return { valid: true };
}

// Create a focused summary of the policy document
function createSummary(text: string, maxLength: number = 8000): string {
  // Focus on key sections
  const sections = [
    'sum insured', 'room rent', 'co-pay', 'waiting period', 'pre-existing',
    'exclusion', 'day care', 'hospitalization', 'network', 'cashless',
    'restore', 'bonus', 'coverage', 'benefit', 'treatment', 'claim'
  ];
  
  const lines = text.split(/[\n\r]+/);
  const relevantLines: string[] = [];
  let currentLength = 0;
  
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (sections.some(s => lower.includes(s)) && line.trim().length > 20) {
      if (currentLength + line.length < maxLength) {
        relevantLines.push(line.trim());
        currentLength += line.length;
      }
    }
  }
  
  return relevantLines.join('\n') || text.substring(0, maxLength);
}

// Call AI Gateway with simple text response
async function callAI(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch(AI_GATEWAY, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are a health insurance policy analyst. Respond ONLY with the exact format requested. Be concise.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.1
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

interface ExtractedFeature {
  name: string;
  value: string;
  category: 'GREAT' | 'GOOD' | 'RED_FLAG' | 'UNCLEAR';
  quote: string;
  reference: string;
  isUnique?: boolean;
}

// Parse AI response in simple text format
function parseFeatureResponse(text: string): ExtractedFeature[] {
  const features: ExtractedFeature[] = [];
  const blocks = text.split(/---+|\n\n+/).filter(b => b.trim());
  
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l);
    const feature: Partial<ExtractedFeature> = {};
    
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();
      
      const keyLower = key.toLowerCase().trim();
      if (keyLower.includes('feature') || keyLower.includes('name')) {
        feature.name = value;
      } else if (keyLower.includes('value') || keyLower.includes('finding')) {
        feature.value = value;
      } else if (keyLower.includes('category') || keyLower.includes('rating')) {
        const cat = value.toUpperCase().replace(/[^A-Z_]/g, '');
        if (['GREAT', 'GOOD', 'RED_FLAG', 'UNCLEAR'].includes(cat)) {
          feature.category = cat as ExtractedFeature['category'];
        } else if (cat.includes('RED') || cat.includes('BAD') || cat.includes('FLAG')) {
          feature.category = 'RED_FLAG';
        } else {
          feature.category = 'GOOD';
        }
      } else if (keyLower.includes('quote') || keyLower.includes('policy states')) {
        feature.quote = value;
      } else if (keyLower.includes('reference') || keyLower.includes('section') || keyLower.includes('page')) {
        feature.reference = value;
      } else if (keyLower.includes('unique')) {
        feature.isUnique = value.toLowerCase().includes('true') || value.toLowerCase().includes('yes');
      }
    }
    
    if (feature.name && feature.value) {
      features.push({
        name: feature.name,
        value: feature.value,
        category: feature.category || 'GOOD',
        quote: feature.quote || '',
        reference: feature.reference || '',
        isUnique: feature.isUnique
      });
    }
  }
  
  return features;
}

// Extract policy basic info
async function extractPolicyInfo(summary: string, apiKey: string, startTime: number): Promise<{ policyName: string; insurer: string; sumInsured: string }> {
  const prompt = `From this health insurance policy text, extract ONLY these 3 items.
Respond in EXACTLY this format (one line each):
POLICY_NAME: [exact product name]
INSURER: [insurance company name]
SUM_INSURED: [coverage amount]

Policy text:
${summary.substring(0, 3000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Policy info response: ${response.substring(0, 100)}...`, startTime);
    
    const lines = response.split('\n');
    let policyName = "Health Insurance Policy";
    let insurer = "Insurance Company";
    let sumInsured = "As per policy schedule";
    
    for (const line of lines) {
      if (line.includes('POLICY_NAME:')) policyName = line.split(':').slice(1).join(':').trim() || policyName;
      if (line.includes('INSURER:')) insurer = line.split(':').slice(1).join(':').trim() || insurer;
      if (line.includes('SUM_INSURED:')) sumInsured = line.split(':').slice(1).join(':').trim() || sumInsured;
    }
    
    return { policyName, insurer, sumInsured };
  } catch (e) {
    log("AI_ERROR", `Policy info failed: ${e}`, startTime);
    return { policyName: "Health Insurance Policy", insurer: "Insurance Company", sumInsured: "As per policy schedule" };
  }
}

// Extract waiting periods
async function extractWaitingPeriods(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `Analyze this health insurance policy for WAITING PERIODS. Find these 3 features:
1. Pre-Existing Disease Waiting Period (typically 2-4 years)
2. Specific Illness Waiting Period (typically 1-2 years)  
3. Initial Waiting Period (typically 30 days)

For each feature found, respond in this EXACT format:
---
FEATURE: [Feature Name]
VALUE: [specific period, e.g., "24 months" or "30 days"]
CATEGORY: [GREAT if shorter than typical, GOOD if average, RED_FLAG if longer than typical, UNCLEAR if not found]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
---

Policy text:
${summary.substring(0, 4000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Waiting periods: ${response.length} chars`, startTime);
    return parseFeatureResponse(response);
  } catch (e) {
    log("AI_ERROR", `Waiting periods failed: ${e}`, startTime);
    return [];
  }
}

// Extract coverage limits
async function extractCoverageLimits(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `Analyze this health insurance policy for COVERAGE LIMITS. Find these 3 features:
1. Room Rent Limit (best: no limit, worst: capped with proportionate deduction)
2. Co-payment/Co-pay (best: nil/0%, worst: mandatory high percentage)
3. Consumables Coverage (best: fully covered, worst: excluded)

For each feature found, respond in this EXACT format:
---
FEATURE: [Feature Name]
VALUE: [specific limit or coverage detail]
CATEGORY: [GREAT if very favorable, GOOD if reasonable, RED_FLAG if restrictive, UNCLEAR if ambiguous]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
---

Policy text:
${summary.substring(0, 4000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Coverage limits: ${response.length} chars`, startTime);
    return parseFeatureResponse(response);
  } catch (e) {
    log("AI_ERROR", `Coverage limits failed: ${e}`, startTime);
    return [];
  }
}

// Extract benefits
async function extractBenefits(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `Analyze this health insurance policy for KEY BENEFITS. Find these 3 features:
1. Restore/Recharge Benefit (replenishes sum insured after claim)
2. No Claim Bonus (cumulative bonus for claim-free years)
3. Day Care Procedures (number of procedures covered)

For each feature found, respond in this EXACT format:
---
FEATURE: [Feature Name]
VALUE: [specific benefit detail]
CATEGORY: [GREAT if generous, GOOD if standard, RED_FLAG if missing/limited, UNCLEAR if not specified]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
---

Policy text:
${summary.substring(0, 4000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Benefits: ${response.length} chars`, startTime);
    return parseFeatureResponse(response);
  } catch (e) {
    log("AI_ERROR", `Benefits failed: ${e}`, startTime);
    return [];
  }
}

// Extract treatments
async function extractTreatments(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `Analyze this health insurance policy for TREATMENT COVERAGE. Find these 3 features:
1. Modern/Advanced Treatments (robotic surgery, stem cell therapy, etc.)
2. AYUSH Treatment (Ayurveda, Yoga, Unani, Siddha, Homeopathy)
3. Maternity Coverage (if mentioned)

For each feature found, respond in this EXACT format:
---
FEATURE: [Feature Name]
VALUE: [coverage status and any limits]
CATEGORY: [GREAT if fully covered, GOOD if covered with limits, RED_FLAG if excluded, UNCLEAR if ambiguous]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
---

Policy text:
${summary.substring(0, 4000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Treatments: ${response.length} chars`, startTime);
    return parseFeatureResponse(response);
  } catch (e) {
    log("AI_ERROR", `Treatments failed: ${e}`, startTime);
    return [];
  }
}

// Extract network and hospitalization
async function extractNetworkAndHospitalization(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `Analyze this health insurance policy for NETWORK & HOSPITALIZATION. Find these 3 features:
1. Network Hospitals (number of cashless hospitals)
2. Pre-Hospitalization Coverage (days covered before admission)
3. Post-Hospitalization Coverage (days covered after discharge)

For each feature found, respond in this EXACT format:
---
FEATURE: [Feature Name]
VALUE: [specific number or coverage detail]
CATEGORY: [GREAT if above average, GOOD if standard, RED_FLAG if limited, UNCLEAR if not specified]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
---

Policy text:
${summary.substring(0, 4000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Network: ${response.length} chars`, startTime);
    return parseFeatureResponse(response);
  } catch (e) {
    log("AI_ERROR", `Network failed: ${e}`, startTime);
    return [];
  }
}

// UNIQUE FEATURE DISCOVERY - the key differentiator
async function discoverUniqueFeatures(summary: string, apiKey: string, startTime: number): Promise<ExtractedFeature[]> {
  const prompt = `You are analyzing a health insurance policy to find UNIQUE or UNUSUAL features that stand out.

Look for features that are NOT standard (not waiting periods, room rent, co-pay, etc.) but are:
- Innovative benefits: mental health coverage, wellness programs, second opinion, international coverage, AI diagnostics
- Unusual inclusions: air ambulance, organ donor expenses, domiciliary hospitalization, bariatric surgery
- Hidden restrictions: unusual exclusions, sub-limits on specific treatments, geographic restrictions
- Vague clauses: ambiguous wording that could be interpreted against the policyholder
- Above-average provisions: anything exceptionally generous or restrictive

Find 3-5 UNIQUE features. For each, respond in this EXACT format:
---
FEATURE: [Descriptive Name]
VALUE: [What the policy says about it]
CATEGORY: [GREAT if excellent benefit, GOOD if positive, RED_FLAG if concerning, UNCLEAR if needs clarification]
QUOTE: [brief quote from policy, max 50 chars]
REFERENCE: [section/page if visible]
UNIQUE: true
---

Policy text:
${summary.substring(0, 5000)}`;

  try {
    const response = await callAI(prompt, apiKey);
    log("AI", `Unique features: ${response.length} chars`, startTime);
    const features = parseFeatureResponse(response);
    // Mark all as unique
    return features.map(f => ({ ...f, isUnique: true }));
  } catch (e) {
    log("AI_ERROR", `Unique features failed: ${e}`, startTime);
    return [];
  }
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { policyText } = await req.json();
    log("INIT", `v${VERSION} - Received ${policyText?.length || 0} chars`, startTime);

    if (!policyText) {
      return new Response(
        JSON.stringify({ error: "No policy text provided" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get API key
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Validate document
    const validation = validateDocument(policyText);
    if (!validation.valid) {
      log("VALIDATE", `Failed: ${validation.error}`, startTime);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    log("VALIDATE", "Passed", startTime);

    // Create focused summary
    const summary = createSummary(policyText);
    log("SUMMARY", `Created ${summary.length} char summary`, startTime);

    // Run all AI extractions in parallel for speed
    log("AI", "Starting parallel AI extractions", startTime);
    
    const [
      policyInfo,
      waitingPeriods,
      coverageLimits,
      benefits,
      treatments,
      network,
      uniqueFeatures
    ] = await Promise.all([
      extractPolicyInfo(summary, apiKey, startTime),
      extractWaitingPeriods(summary, apiKey, startTime),
      extractCoverageLimits(summary, apiKey, startTime),
      extractBenefits(summary, apiKey, startTime),
      extractTreatments(summary, apiKey, startTime),
      extractNetworkAndHospitalization(summary, apiKey, startTime),
      discoverUniqueFeatures(summary, apiKey, startTime)
    ]);

    log("AI", "All extractions complete", startTime);

    // Combine all features
    const allFeatures = [
      ...waitingPeriods,
      ...coverageLimits,
      ...benefits,
      ...treatments,
      ...network,
      ...uniqueFeatures
    ];

    log("COMBINE", `Total features: ${allFeatures.length}`, startTime);

    // Group by category
    const greatFeatures = allFeatures.filter(f => f.category === 'GREAT');
    const goodFeatures = allFeatures.filter(f => f.category === 'GOOD');
    const redFlags = allFeatures.filter(f => f.category === 'RED_FLAG');
    const needsClarification = allFeatures.filter(f => f.category === 'UNCLEAR');

    // Format for frontend
    const formatFeature = (f: ExtractedFeature) => ({
      name: f.name,
      policyStates: f.value,
      reference: f.reference || '',
      explanation: f.quote || f.value,
      isUnique: f.isUnique || false
    });

    const result = {
      policyName: policyInfo.policyName,
      insurer: policyInfo.insurer,
      sumInsured: policyInfo.sumInsured,
      policyType: "Health Insurance",
      summary: {
        great: greatFeatures.length,
        good: goodFeatures.length,
        redFlags: redFlags.length,
        unclear: needsClarification.length
      },
      greatFeatures: greatFeatures.map(formatFeature),
      goodFeatures: goodFeatures.map(formatFeature),
      redFlags: redFlags.map(formatFeature),
      needsClarification: needsClarification.map(formatFeature),
      disclaimer: "This AI analysis is for informational purposes only. Please verify all details with your insurer and read the full policy document.",
      _meta: {
        version: VERSION,
        processingTimeMs: Date.now() - startTime,
        totalFeatures: allFeatures.length,
        uniqueFeatures: uniqueFeatures.length
      }
    };

    log("DONE", `${Date.now() - startTime}ms, ${allFeatures.length} features (${uniqueFeatures.length} unique)`, startTime);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    log("ERROR", error.message, startTime);
    return new Response(
      JSON.stringify({ error: "Analysis failed. Please try again.", _debug: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
