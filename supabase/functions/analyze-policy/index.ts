import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ CONFIG - SINGLE SOURCE OF TRUTH                                           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const CONFIG = {
  version: "4.0.0",
  model: "gemini-2.5-flash",  // NOT lite
  
  api: {
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    backoffMultiplier: 2,
    timeoutMs: 55000,
    temperature: 0.1
  },

  tokens: {
    extraction: 8000,
    judgmentAndExplanations: 6000
  },

  validation: {
    minDocLength: 500,
    healthKeywords: [
      'hospitalization', 'sum insured', 'cashless', 'pre-existing',
      'waiting period', 'room rent', 'irdai', 'tpa', 'network hospital',
      'inpatient', 'day care', 'co-pay', 'copay', 'claim', 'mediclaim',
      'health insurance', 'policy wording', 'insured person'
    ],
    wrongDocKeywords: [
      'life insurance', 'term plan', 'death benefit', 'maturity benefit',
      'motor insurance', 'vehicle insurance', 'car insurance', 'bike insurance',
      'bank statement', 'transaction history', 'account summary',
      'resume', 'curriculum vitae', 'invoice', 'purchase order'
    ],
    minHealthKeywords: 5
  },

  // ─────────────────────────────────────────────────────────────────────────
  // KNOWN FEATURES - Code will classify these using thresholds
  // ─────────────────────────────────────────────────────────────────────────
  knownFeatures: {
    pedWaiting: {
      displayName: "Pre-Existing Disease Waiting Period",
      thresholds: { great: { max: 23 }, good: { min: 24, max: 36 }, redFlag: { min: 37 } },
      unit: "months"
    },
    specificIllnessWaiting: {
      displayName: "Specific Illness Waiting Period", 
      thresholds: { great: { max: 11 }, good: { min: 12, max: 24 }, redFlag: { min: 25 } },
      unit: "months"
    },
    initialWaiting: {
      displayName: "Initial Waiting Period",
      thresholds: { great: { max: 0 }, good: { min: 1, max: 30 }, redFlag: { min: 31 } },
      unit: "days"
    },
    preHospitalization: {
      displayName: "Pre-Hospitalization Coverage",
      thresholds: { great: { min: 60 }, good: { min: 30, max: 59 }, redFlag: { max: 29 } },
      unit: "days"
    },
    postHospitalization: {
      displayName: "Post-Hospitalization Coverage",
      thresholds: { great: { min: 180 }, good: { min: 60, max: 179 }, redFlag: { max: 59 } },
      unit: "days"
    },
    roomRent: {
      displayName: "Room Rent",
      // Special handling - not pure numeric
      rules: {
        great: ["no limit", "no cap", "any room", "no restriction"],
        good: ["single private", "single ac", "single occupancy"],
        redFlag: ["proportionate deduction", "daily limit", "capped at", "% of si"]
      }
    },
    coPay: {
      displayName: "Co-payment",
      // Special handling - context matters
      rules: {
        great: ["no co-pay", "nil", "0%", "not applicable"],
        good: ["optional", "voluntary", "senior citizen only", "above 60"],
        redFlag: ["mandatory", "all claims", "all ages", "zone based"]
      }
    },
    restore: {
      displayName: "Restore/Recharge Benefit",
      rules: {
        great: ["unlimited", "same illness", "any illness", "100% restore"],
        good: ["different illness", "unrelated illness", "once per year"],
        redFlag: ["not available", "no restore", "not applicable"]
      }
    },
    consumables: {
      displayName: "Consumables Coverage",
      rules: {
        great: ["fully covered", "no sub-limit", "100% covered"],
        good: ["covered", "included", "payable"],
        redFlag: ["not covered", "excluded", "patient bears"]
      }
    },
    daycare: {
      displayName: "Day Care Procedures",
      thresholds: { great: { min: 500 }, good: { min: 140, max: 499 }, redFlag: { max: 139 } },
      unit: "procedures"
    },
    networkHospitals: {
      displayName: "Cashless Hospital Network",
      thresholds: { great: { min: 10000 }, good: { min: 5000, max: 9999 }, redFlag: { max: 4999 } },
      unit: "hospitals"
    },
    ncb: {
      displayName: "No Claim Bonus",
      thresholds: { great: { min: 50 }, good: { min: 10, max: 49 }, redFlag: { max: 9 } },
      unit: "percent per year"
    },
    modernTreatments: {
      displayName: "Modern Treatment Coverage",
      rules: {
        great: ["fully covered", "no sub-limit", "all treatments"],
        good: ["covered", "included", "as per terms"],
        redFlag: ["not covered", "excluded", "sub-limits apply"]
      }
    },
    ayush: {
      displayName: "AYUSH Treatment",
      rules: {
        great: ["full si", "no sub-limit", "100%"],
        good: ["covered", "included", "up to"],
        redFlag: ["not covered", "excluded"]
      }
    }
  },

  // Standard IRDAI exclusions - don't flag these as bad
  standardExclusions: [
    "cosmetic", "plastic surgery", "dental", "spectacles", "contact lens",
    "obesity", "weight loss", "self-inflicted", "suicide attempt",
    "war", "terrorism", "nuclear", "adventure sports", "hazardous activities",
    "infertility", "ivf", "sterility", "change of gender",
    "experimental treatment", "unproven treatment"
  ]
};

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ TYPES                                                                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

type Category = "GREAT" | "GOOD" | "RED_FLAG" | "UNCLEAR";

interface ExtractedFeature {
  id: string;
  name: string;
  value: string | number | null;
  rawText: string;
  quote: string;
  reference: string;
}

interface ClassifiedFeature {
  id: string;
  name: string;
  value: string | number | null;
  quote: string;
  reference: string;
  category: Category;
  explanation: string;
  classifiedBy: "code" | "ai";
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ UTILITIES                                                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function log(step: string, message: string, startTime: number) {
  console.log(`[${Date.now() - startTime}ms] [${step}] ${message}`);
}

async function callGemini(
  apiKey: string, 
  prompt: string, 
  schema: object, 
  maxTokens: number,
  startTime: number,
  stepName: string
): Promise<any> {
  const { maxRetries, initialRetryDelayMs, backoffMultiplier, timeoutMs, temperature } = CONFIG.api;
  let delay = initialRetryDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(stepName, `Attempt ${attempt}/${maxRetries}`, startTime);
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              responseMimeType: "application/json",
              responseSchema: schema
            }
          })
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API ${response.status}: ${errorBody.substring(0, 200)}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      // Parse JSON, with repair for truncated responses
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        // Try to repair truncated JSON
        let repaired = text.trim();
        const openBraces = (repaired.match(/{/g) || []).length;
        const closeBraces = (repaired.match(/}/g) || []).length;
        const openBrackets = (repaired.match(/\[/g) || []).length;
        const closeBrackets = (repaired.match(/\]/g) || []).length;
        
        for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
        for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
        
        parsed = JSON.parse(repaired);
        log(stepName, 'Repaired truncated JSON', startTime);
      }

      log(stepName, 'Success', startTime);
      return parsed;

    } catch (error: any) {
      log(stepName, `Error: ${error.message}`, startTime);
      
      if (attempt < maxRetries) {
        log(stepName, `Retrying in ${delay}ms...`, startTime);
        await new Promise(r => setTimeout(r, delay));
        delay *= backoffMultiplier;
      } else {
        throw error;
      }
    }
  }
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ STEP 2: CODE VALIDATION                                                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function validateDocument(text: string): { valid: boolean; error?: string } {
  if (text.length < CONFIG.validation.minDocLength) {
    return { valid: false, error: "Document too short. Please upload the complete policy document." };
  }

  const lowerText = text.substring(0, 10000).toLowerCase();
  
  // Check for wrong document types
  const wrongHits = CONFIG.validation.wrongDocKeywords.filter(kw => lowerText.includes(kw));
  if (wrongHits.length >= 2) {
    return { 
      valid: false, 
      error: `This doesn't appear to be a health insurance policy. Detected: ${wrongHits.slice(0, 2).join(', ')}.` 
    };
  }

  // Check for health insurance keywords
  const healthHits = CONFIG.validation.healthKeywords.filter(kw => lowerText.includes(kw));
  if (healthHits.length < CONFIG.validation.minHealthKeywords) {
    return { 
      valid: false, 
      error: "This doesn't appear to be a health insurance policy document. Please upload a policy wording or schedule." 
    };
  }

  return { valid: true };
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ STEP 3: GEMINI EXTRACTION                                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const extractionSchema = {
  type: "object",
  properties: {
    policyInfo: {
      type: "object",
      properties: {
        name: { type: "string" },
        insurer: { type: "string" },
        sumInsured: { type: "string" },
        policyType: { type: "string" }
      }
    },
    features: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          value: { type: "string" },
          numericValue: { type: "number", nullable: true },
          unit: { type: "string" },
          quote: { type: "string" },
          reference: { type: "string" },
          isKnownFeature: { type: "boolean" }
        },
        required: ["id", "name", "value", "quote", "reference", "isKnownFeature"]
      }
    }
  },
  required: ["policyInfo", "features"]
};

function buildExtractionPrompt(policyText: string): string {
  const knownFeaturesList = Object.entries(CONFIG.knownFeatures)
    .map(([id, config]) => `- ${id}: ${config.displayName}`)
    .join('\n');

  return `You are extracting features from an Indian health insurance policy document.

TASK: Extract ALL features mentioned in the policy with their exact values.

KNOWN FEATURES TO LOOK FOR:
${knownFeaturesList}

EXTRACTION RULES:
1. For each feature found, extract:
   - id: Use the known feature ID if it matches (e.g., "pedWaiting"), otherwise create a descriptive ID (e.g., "unique_2x_cover")
   - name: Human-readable name
   - value: The exact value as stated (e.g., "36 months", "Single Private AC Room", "20% for age 60+")
   - numericValue: Extract just the number if applicable (e.g., 36, 20), null if not numeric
   - unit: The unit (months, days, percent, hospitals, etc.)
   - quote: Copy 10-30 words from the policy containing this information
   - reference: Section, clause, or page reference
   - isKnownFeature: true if it matches a known feature ID, false if it's unique/special

2. CAPTURE UNIQUE FEATURES: If you find benefits not in the known list (like "2x Cover", "Compassionate Visit", "Second Opinion", "Wellness Rewards"), extract them with isKnownFeature: false

3. IMPORTANT DISTINCTIONS:
   - Room rent with "proportionate deduction" is different from room rent with a limit
   - Co-pay that is "optional" or "only for seniors" is different from "mandatory for all"
   - Restore for "same illness" is different from "different illness only"

4. DO NOT categorize or explain. Just extract raw data.

POLICY TEXT:
${policyText}`;
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ STEP 4: CODE CLASSIFICATION                                                ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

function classifyKnownFeature(
  featureId: string, 
  value: string, 
  numericValue: number | null
): { category: Category; reason: string } | null {
  
  const config = CONFIG.knownFeatures[featureId as keyof typeof CONFIG.knownFeatures];
  if (!config) return null;

  const lowerValue = value.toLowerCase();

  // Handle threshold-based features
  if ('thresholds' in config && numericValue !== null) {
    const t = config.thresholds as any;
    
    // For "higher is better" features (pre/post hospitalization, daycare, network, ncb)
    if (featureId === 'preHospitalization' || featureId === 'postHospitalization' || 
        featureId === 'daycare' || featureId === 'networkHospitals' || featureId === 'ncb') {
      if (t.great?.min !== undefined && numericValue >= t.great.min) {
        return { category: "GREAT", reason: `${numericValue} ${config.unit} meets excellent threshold (≥${t.great.min})` };
      }
      if (t.good?.min !== undefined && t.good?.max !== undefined && numericValue >= t.good.min && numericValue <= t.good.max) {
        return { category: "GOOD", reason: `${numericValue} ${config.unit} is standard (${t.good.min}-${t.good.max})` };
      }
      if (t.redFlag?.max !== undefined && numericValue <= t.redFlag.max) {
        return { category: "RED_FLAG", reason: `${numericValue} ${config.unit} is below standard (≤${t.redFlag.max})` };
      }
    }
    
    // For "lower is better" features (waiting periods)
    if (featureId === 'pedWaiting' || featureId === 'specificIllnessWaiting' || featureId === 'initialWaiting') {
      if (t.great?.max !== undefined && numericValue <= t.great.max) {
        return { category: "GREAT", reason: `${numericValue} ${config.unit} is excellent (≤${t.great.max})` };
      }
      if (t.good?.min !== undefined && t.good?.max !== undefined && numericValue >= t.good.min && numericValue <= t.good.max) {
        return { category: "GOOD", reason: `${numericValue} ${config.unit} is standard (${t.good.min}-${t.good.max})` };
      }
      if (t.redFlag?.min !== undefined && numericValue >= t.redFlag.min) {
        return { category: "RED_FLAG", reason: `${numericValue} ${config.unit} exceeds acceptable limit (≥${t.redFlag.min})` };
      }
    }
  }

  // Handle rule-based features
  if ('rules' in config) {
    const rules = config.rules;
    
    // Check for RED_FLAG first (most important to catch)
    if (rules.redFlag?.some(phrase => lowerValue.includes(phrase))) {
      return { category: "RED_FLAG", reason: `Contains concerning term` };
    }
    
    // Check for GREAT
    if (rules.great?.some(phrase => lowerValue.includes(phrase))) {
      return { category: "GREAT", reason: `Contains excellent term` };
    }
    
    // Check for GOOD
    if (rules.good?.some(phrase => lowerValue.includes(phrase))) {
      return { category: "GOOD", reason: `Contains standard term` };
    }
  }

  // If we have the feature but couldn't classify, mark unclear
  return { category: "UNCLEAR", reason: "Could not determine category from value" };
}

function classifyFeatures(extractedFeatures: any[]): {
  classified: Array<{ feature: any; category: Category; reason: string }>;
  needsAiJudgment: any[];
} {
  const classified: Array<{ feature: any; category: Category; reason: string }> = [];
  const needsAiJudgment: any[] = [];

  for (const feature of extractedFeatures) {
    if (feature.isKnownFeature) {
      const result = classifyKnownFeature(feature.id, feature.value, feature.numericValue);
      if (result && result.category !== "UNCLEAR") {
        classified.push({ feature, category: result.category, reason: result.reason });
      } else {
        needsAiJudgment.push(feature);
      }
    } else {
      // Unknown/unique feature - needs AI judgment
      needsAiJudgment.push(feature);
    }
  }

  return { classified, needsAiJudgment };
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ STEP 5: GEMINI JUDGMENT + EXPLANATIONS                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const judgmentSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ["GREAT", "GOOD", "RED_FLAG", "UNCLEAR"] },
          explanation: { type: "string" }
        },
        required: ["id", "category", "explanation"]
      }
    }
  },
  required: ["results"]
};

function buildJudgmentPrompt(
  classifiedFeatures: Array<{ feature: any; category: Category; reason: string }>,
  uncategorizedFeatures: any[],
  policyInfo: any
): string {
  
  const classifiedList = classifiedFeatures.map(cf => 
    `- ${cf.feature.name}: ${cf.feature.value} → ${cf.category} (Code assigned)\n  Quote: "${cf.feature.quote}"\n  Reference: ${cf.feature.reference}`
  ).join('\n');

  const uncategorizedList = uncategorizedFeatures.map(f =>
    `- ID: ${f.id}\n  Name: ${f.name}\n  Value: ${f.value}\n  Quote: "${f.quote}"\n  Reference: ${f.reference}`
  ).join('\n\n');

  const allFeatureIds = [
    ...classifiedFeatures.map(cf => cf.feature.id),
    ...uncategorizedFeatures.map(f => f.id)
  ];

  return `You are writing explanations for health insurance policy features and categorizing unknown features.

POLICY: ${policyInfo.name || 'Health Insurance Policy'} by ${policyInfo.insurer || 'Unknown Insurer'}

═══════════════════════════════════════════════════════════════════════
TASK 1: CATEGORIZE THESE UNKNOWN/UNIQUE FEATURES
═══════════════════════════════════════════════════════════════════════

${uncategorizedFeatures.length > 0 ? uncategorizedList : 'None - all features were categorized by code.'}

CATEGORIZATION RULES:
- GREAT: Rare benefit (<20% of policies have it), significantly helps the customer
- GOOD: Useful, standard in the market
- RED_FLAG: Has hidden catches, restrictions, or is below industry standard
- UNCLEAR: Vague language, needs verification with insurer

═══════════════════════════════════════════════════════════════════════
TASK 2: WRITE EXPLANATIONS FOR ALL FEATURES (categorized + uncategorized)
═══════════════════════════════════════════════════════════════════════

ALREADY CATEGORIZED BY CODE:
${classifiedFeatures.length > 0 ? classifiedList : 'None'}

EXPLANATION RULES:
1. Write 1-2 sentences in simple English
2. Explain what this means for the customer practically
3. For GREAT: Explain why this is better than typical policies
4. For GOOD: Note this is standard/acceptable
5. For RED_FLAG: Clearly explain the risk or problem
6. For UNCLEAR: Explain what needs verification
7. Use actual numbers from the policy

RESPOND WITH:
For each feature ID (${allFeatureIds.join(', ')}), provide:
- id: the feature ID
- category: only for uncategorized features (${uncategorizedFeatures.map(f => f.id).join(', ') || 'none'})
- explanation: 1-2 sentence explanation for ALL features`;
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ MAIN HANDLER                                                               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

serve(async (req) => {
  const startTime = Date.now();
  
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Parse request
    // ─────────────────────────────────────────────────────────────────────────
    const { policyText } = await req.json();
    log("INIT", `Received ${policyText?.length || 0} chars`, startTime);

    if (!policyText) {
      return new Response(
        JSON.stringify({ error: "No policy text provided" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Code Validation
    // ─────────────────────────────────────────────────────────────────────────
    log("VALIDATE", "Checking document type", startTime);
    const validation = validateDocument(policyText);
    
    if (!validation.valid) {
      log("VALIDATE", `Failed: ${validation.error}`, startTime);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    log("VALIDATE", "Passed", startTime);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Gemini Call #1 - Extraction
    // ─────────────────────────────────────────────────────────────────────────
    log("EXTRACT", "Starting extraction", startTime);
    
    const extractionPrompt = buildExtractionPrompt(policyText);
    const extracted = await callGemini(
      apiKey, 
      extractionPrompt, 
      extractionSchema, 
      CONFIG.tokens.extraction,
      startTime,
      "EXTRACT"
    );

    log("EXTRACT", `Found ${extracted.features?.length || 0} features`, startTime);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: Code Classification
    // ─────────────────────────────────────────────────────────────────────────
    log("CLASSIFY", "Classifying known features", startTime);
    
    const { classified, needsAiJudgment } = classifyFeatures(extracted.features || []);
    
    log("CLASSIFY", `Code classified: ${classified.length}, Needs AI: ${needsAiJudgment.length}`, startTime);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: Gemini Call #2 - Judgment + Explanations
    // ─────────────────────────────────────────────────────────────────────────
    log("EXPLAIN", "Starting judgment + explanations", startTime);
    
    const judgmentPrompt = buildJudgmentPrompt(classified, needsAiJudgment, extracted.policyInfo);
    const judgmentResult = await callGemini(
      apiKey,
      judgmentPrompt,
      judgmentSchema,
      CONFIG.tokens.judgmentAndExplanations,
      startTime,
      "EXPLAIN"
    );

    log("EXPLAIN", `Got ${judgmentResult.results?.length || 0} results`, startTime);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: Merge & Format
    // ─────────────────────────────────────────────────────────────────────────
    log("FORMAT", "Merging results", startTime);

    // Create lookup for AI results
    const aiResults = new Map<string, { category?: Category; explanation: string }>();
    for (const r of judgmentResult.results || []) {
      aiResults.set(r.id, { category: r.category, explanation: r.explanation });
    }

    // Build final features list
    const finalFeatures: ClassifiedFeature[] = [];

    // Add code-classified features with AI explanations
    for (const cf of classified) {
      const aiResult = aiResults.get(cf.feature.id);
      finalFeatures.push({
        id: cf.feature.id,
        name: cf.feature.name,
        value: cf.feature.value,
        quote: cf.feature.quote,
        reference: cf.feature.reference,
        category: cf.category,
        explanation: aiResult?.explanation || `${cf.feature.name}: ${cf.feature.value}`,
        classifiedBy: "code"
      });
    }

    // Add AI-judged features
    for (const f of needsAiJudgment) {
      const aiResult = aiResults.get(f.id);
      finalFeatures.push({
        id: f.id,
        name: f.name,
        value: f.value,
        quote: f.quote,
        reference: f.reference,
        category: (aiResult?.category as Category) || "UNCLEAR",
        explanation: aiResult?.explanation || `${f.name}: ${f.value}`,
        classifiedBy: "ai"
      });
    }

    // Group by category
    const great = finalFeatures.filter(f => f.category === "GREAT");
    const good = finalFeatures.filter(f => f.category === "GOOD");
    const redFlags = finalFeatures.filter(f => f.category === "RED_FLAG");
    const unclear = finalFeatures.filter(f => f.category === "UNCLEAR");

    // Format output
    const formatFeature = (f: ClassifiedFeature) => ({
      name: f.name,
      policyStates: f.quote,
      reference: f.reference,
      explanation: f.explanation
    });

    const result = {
      policyName: extracted.policyInfo?.name || "Health Insurance Policy",
      insurer: extracted.policyInfo?.insurer || "Unknown Insurer",
      sumInsured: extracted.policyInfo?.sumInsured || "See policy schedule",
      policyType: extracted.policyInfo?.policyType || "Individual/Family Floater",
      summary: {
        great: great.length,
        good: good.length,
        redFlags: redFlags.length,
        unclear: unclear.length
      },
      greatFeatures: great.map(formatFeature),
      goodFeatures: good.map(formatFeature),
      redFlags: redFlags.map(formatFeature),
      needsClarification: unclear.map(formatFeature),
      disclaimer: "This analysis is for informational purposes only. Standard IRDAI exclusions apply. Please verify all details with your insurer before making decisions.",
      _meta: {
        version: CONFIG.version,
        model: CONFIG.model,
        processingTimeMs: Date.now() - startTime,
        featuresExtracted: extracted.features?.length || 0,
        classifiedByCode: classified.length,
        classifiedByAi: needsAiJudgment.length
      }
    };

    log("DONE", `Total time: ${Date.now() - startTime}ms`, startTime);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    log("ERROR", error.message, startTime);
    
    // User-friendly error messages
    let userMessage = "Analysis failed. Please try again.";
    if (error.message?.includes('429')) {
      userMessage = "Service is busy. Please try again in a moment.";
    } else if (error.message?.includes('timeout') || error.message?.includes('abort')) {
      userMessage = "Analysis took too long. Please try again.";
    }

    return new Response(
      JSON.stringify({ error: userMessage, _debug: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
