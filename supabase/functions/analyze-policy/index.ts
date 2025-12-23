import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  system: {
    model: "gemini-2.5-flash",
    version: "3.0.0",
    api: {
      maxRetries: 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2,
      temperature: 0.1
    },
    tokens: {
      validation: 500,
      extraction: 8192,
      judgment: 800
    },
    cache: {
      enabled: true,
      ttlSeconds: 604800,
      maxEntries: 100
    },
    document: {
      minLength: 500,
      validationSample: 4000,
      chunkSize: 100000,
      chunkOverlap: 2000,
      maxChunks: 5
    },
    bounds: {
      months: [0, 120],
      days: [0, 730],
      percentage: [0, 100],
      count: [0, 100000],
      amount: [0, 1000000000]
    }
  },

  thresholds: {
    pedWaiting: { great: { max: 23 }, good: { min: 24, max: 36 }, redFlag: { min: 37 } },
    specificIllnessWaiting: { great: { max: 23 }, good: { exact: 24 }, redFlag: { min: 25 } },
    initialWaiting: { great: { max: 0 }, good: { min: 1, max: 30 }, redFlag: { min: 31 } },
    preHospitalization: { great: { min: 60 }, good: { min: 30, max: 59 }, redFlag: { max: 29 } },
    postHospitalization: { great: { min: 180 }, good: { min: 60, max: 179 }, redFlag: { max: 59 } },
    coPay: { great: { max: 0 }, good: { max: 20 }, redFlag: { min: 21 } },
    networkHospitals: { great: { min: 10000 }, good: { min: 5000, max: 9999 }, redFlag: { max: 4999 } },
    ncb: { great: { min: 50 }, good: { min: 10, max: 49 }, redFlag: { max: 9 } }
  },

  standardExclusions: [
    "maternity", "pregnancy", "childbirth", "infertility", "ivf",
    "cosmetic", "plastic surgery", "aesthetic", "beauty",
    "dental", "teeth", "spectacles", "lasik", "hearing aid",
    "obesity", "weight loss", "bariatric",
    "self-inflicted", "self-harm", "suicide",
    "alcoholism", "drug abuse", "substance abuse",
    "hazardous sports", "adventure sports",
    "war", "terrorism", "nuclear",
    "breach of law", "criminal",
    "external congenital", "birth defect",
    "hiv", "aids", "sexually transmitted",
    "vitamins", "tonics", "supplements",
    "experimental", "gender change", "vaccination"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

type Category = "GREAT" | "GOOD" | "RED_FLAG" | "UNCLEAR";

interface AnalyzedFeature {
  name: string;
  category: Category;
  policyStates: string;
  reference: string;
  explanation: string;
  classifiedBy: "code" | "llm";
  ruleApplied?: string;
}

interface CacheEntry {
  result: any;
  timestamp: number;
  version: string;
}

const cache = new Map<string, CacheEntry>();

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function hashDocument(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase().replace(/\s+/g, ' '));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCached(hash: string): any | null {
  if (!CONFIG.system.cache.enabled) return null;
  const entry = cache.get(hash);
  if (!entry || entry.version !== CONFIG.system.version) return null;
  if ((Date.now() - entry.timestamp) / 1000 > CONFIG.system.cache.ttlSeconds) {
    cache.delete(hash);
    return null;
  }
  return entry.result;
}

function setCache(hash: string, result: any): void {
  if (!CONFIG.system.cache.enabled) return;
  cache.set(hash, { result, timestamp: Date.now(), version: CONFIG.system.version });
  if (cache.size > CONFIG.system.cache.maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

function sanitizeNumber(value: number | null, type: 'months' | 'days' | 'percentage' | 'count' | 'amount'): number | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  const [min, max] = CONFIG.system.bounds[type];
  return Math.max(min, Math.min(max, Math.round(value)));
}

function validateQuote(quote: string, document: string): boolean {
  if (!quote || quote.length < 10) return false;
  const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedDoc = document.toLowerCase().replace(/\s+/g, ' ');
  if (normalizedDoc.includes(normalizedQuote)) return true;
  const words = normalizedQuote.split(' ').filter(w => w.length > 4);
  if (words.length < 3) return true;
  let matches = 0;
  for (const word of words) {
    if (normalizedDoc.includes(word)) matches++;
  }
  return matches >= words.length * 0.6;
}

function chunkDocument(text: string): string[] {
  const { chunkSize, chunkOverlap, maxChunks } = CONFIG.system.document;
  if (text.length <= chunkSize) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = start + chunkSize;
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('\n\n', end);
      if (breakPoint > start + chunkSize * 0.7) end = breakPoint;
    }
    chunks.push(text.substring(start, end));
    start = end - chunkOverlap;
  }
  return chunks;
}

function getUserFriendlyError(error: any): string {
  const msg = error?.message || String(error);
  if (msg.includes('429')) return 'Service busy. Please try again in a moment.';
  if (msg.includes('400')) return 'Could not process document. Please ensure it\'s a valid PDF.';
  if (msg.includes('401') || msg.includes('403')) return 'Service configuration error. Contact support.';
  if (msg.includes('timeout')) return 'Analysis taking too long. Try a smaller document.';
  return 'Analysis failed. Please try again.';
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function classifyPedWaiting(months: number | null): { category: Category; rule: string } {
  if (months === null) return { category: "UNCLEAR", rule: "PED waiting not specified" };
  const t = CONFIG.thresholds.pedWaiting;
  if (months <= t.great.max) return { category: "GREAT", rule: `PED ${months} months < 24` };
  if (months <= t.good.max) return { category: "GOOD", rule: `PED ${months} months (24-36 standard)` };
  return { category: "RED_FLAG", rule: `PED ${months} months > 36` };
}

function classifySpecificIllnessWaiting(months: number | null): { category: Category; rule: string } {
  if (months === null) return { category: "UNCLEAR", rule: "Specific illness waiting not specified" };
  const t = CONFIG.thresholds.specificIllnessWaiting;
  if (months < t.good.exact) return { category: "GREAT", rule: `Specific illness ${months} months < 24` };
  if (months === t.good.exact) return { category: "GOOD", rule: `Specific illness 24 months (standard)` };
  return { category: "RED_FLAG", rule: `Specific illness ${months} months > 24` };
}

function classifyInitialWaiting(days: number | null): { category: Category; rule: string } {
  if (days === null) return { category: "UNCLEAR", rule: "Initial waiting not specified" };
  const t = CONFIG.thresholds.initialWaiting;
  if (days <= t.great.max) return { category: "GREAT", rule: "No initial waiting" };
  if (days <= t.good.max) return { category: "GOOD", rule: `Initial waiting ${days} days (standard)` };
  return { category: "RED_FLAG", rule: `Initial waiting ${days} days > 30` };
}

function classifyRoomRent(data: { rawValue: string; hasLimit: boolean; limitAmount: number | null; limitType: string; hasProportionateDeduction: boolean; }): { category: Category; rule: string } {
  if (data.hasProportionateDeduction) return { category: "RED_FLAG", rule: "Proportionate deduction clause" };
  if (data.hasLimit && data.limitAmount) return { category: "RED_FLAG", rule: `Room rent capped ₹${data.limitAmount}/day` };
  if (data.limitType === "percentage") return { category: "RED_FLAG", rule: "Room rent % of SI" };
  const raw = data.rawValue.toLowerCase();
  if (/no limit|no cap|any room|no restriction|no sub-?limit/.test(raw)) return { category: "GREAT", rule: "No room rent limit" };
  if (/single.*private.*ac|single.*ac|single.*room/.test(raw)) return { category: "GOOD", rule: "Single AC room (standard)" };
  return { category: "UNCLEAR", rule: "Room rent terms unclear" };
}

function classifyCoPay(data: { percentage: number | null; isOptional: boolean; appliesToAllAges: boolean; isZoneBased: boolean; }): { category: Category; rule: string } {
  if (data.isOptional) return { category: "GOOD", rule: "Co-pay optional (customer choice)" };
  if (data.percentage === null || data.percentage === 0) return { category: "GREAT", rule: "No co-pay" };
  if (data.isZoneBased) return { category: "RED_FLAG", rule: "Zone-based co-pay" };
  if (data.appliesToAllAges && data.percentage > 0) return { category: "RED_FLAG", rule: `Mandatory ${data.percentage}% co-pay all ages` };
  if (data.percentage > 20) return { category: "RED_FLAG", rule: `Co-pay ${data.percentage}% > 20%` };
  return { category: "GOOD", rule: `Co-pay ${data.percentage}% seniors only` };
}

function classifyRestore(data: { available: boolean; sameIllnessCovered: boolean; unlimited: boolean; }): { category: Category; rule: string } {
  if (!data.available) return { category: "RED_FLAG", rule: "No restore benefit" };
  if (data.sameIllnessCovered || data.unlimited) return { category: "GREAT", rule: "Restore covers same illness" };
  return { category: "GOOD", rule: "Restore for different illness only" };
}

function classifyPreHospitalization(days: number | null): { category: Category; rule: string } {
  if (days === null) return { category: "UNCLEAR", rule: "Pre-hospitalization not specified" };
  const t = CONFIG.thresholds.preHospitalization;
  if (days >= t.great.min) return { category: "GREAT", rule: `Pre-hosp ${days} days >= 60` };
  if (days >= t.good.min) return { category: "GOOD", rule: `Pre-hosp ${days} days (standard)` };
  return { category: "RED_FLAG", rule: `Pre-hosp ${days} days < 30` };
}

function classifyPostHospitalization(days: number | null): { category: Category; rule: string } {
  if (days === null) return { category: "UNCLEAR", rule: "Post-hospitalization not specified" };
  const t = CONFIG.thresholds.postHospitalization;
  if (days >= t.great.min) return { category: "GREAT", rule: `Post-hosp ${days} days >= 180` };
  if (days >= t.good.min) return { category: "GOOD", rule: `Post-hosp ${days} days (standard)` };
  return { category: "RED_FLAG", rule: `Post-hosp ${days} days < 60` };
}

function classifyConsumables(data: { covered: boolean; fullyCovered: boolean }): { category: Category; rule: string } {
  if (!data.covered) return { category: "RED_FLAG", rule: "Consumables not covered" };
  if (data.fullyCovered) return { category: "GREAT", rule: "Consumables fully covered" };
  return { category: "GOOD", rule: "Consumables with sub-limit" };
}

function classifyNetworkHospitals(count: number | null): { category: Category; rule: string } {
  if (count === null) return { category: "UNCLEAR", rule: "Network size not specified" };
  const t = CONFIG.thresholds.networkHospitals;
  if (count >= t.great.min) return { category: "GREAT", rule: `${count}+ hospitals` };
  if (count >= t.good.min) return { category: "GOOD", rule: `${count} hospitals` };
  return { category: "RED_FLAG", rule: `Only ${count} hospitals` };
}

function classifyDaycare(data: { covered: boolean; count: number | null }): { category: Category; rule: string } {
  if (!data.covered) return { category: "RED_FLAG", rule: "Day care not covered" };
  if (data.count && data.count > 400) return { category: "GREAT", rule: `${data.count}+ day care procedures` };
  return { category: "GOOD", rule: "Day care procedures covered" };
}

function classifyNcb(percentage: number | null, maxAccumulation: number | null): { category: Category; rule: string } {
  if (percentage === null) return { category: "UNCLEAR", rule: "NCB not specified" };
  const t = CONFIG.thresholds.ncb;
  if (percentage >= t.great.min) return { category: "GREAT", rule: `NCB ${percentage}% per year` };
  if (percentage >= t.good.min) return { category: "GOOD", rule: `NCB ${percentage}% per year (standard)` };
  return { category: "RED_FLAG", rule: `NCB only ${percentage}%` };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPLANATION GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateExplanation(featureId: string, data: any, category: Category): string {
  const explanations: Record<string, Record<Category, (d: any) => string>> = {
    pedWaiting: {
      GREAT: (d) => `Pre-existing conditions covered in just ${d.months} months — faster than most policies`,
      GOOD: (d) => `${d.months} months (${Math.round(d.months/12)} years) waiting period for pre-existing diseases is standard industry practice and reasonable`,
      RED_FLAG: (d) => `${d.months} months (${Math.round(d.months/12)} years) wait is longer than standard. Your existing conditions remain uncovered for too long`,
      UNCLEAR: () => `PED waiting period not clearly stated. Confirm with insurer before buying`
    },
    specificIllnessWaiting: {
      GREAT: (d) => `Common surgeries like cataract, hernia, knee replacement covered after only ${d.months} months`,
      GOOD: () => `24 months waiting for specific conditions like cataract, hernia, kidney stones is standard industry practice`,
      RED_FLAG: (d) => `${d.months} months wait for common surgeries exceeds the 24-month industry standard`,
      UNCLEAR: () => `Waiting period for specific illnesses/surgeries not specified`
    },
    initialWaiting: {
      GREAT: () => `No initial waiting period — coverage starts from day one`,
      GOOD: () => `30 days initial waiting period is industry standard, with reasonable exception for accidents`,
      RED_FLAG: (d) => `${d.days}-day initial wait is unusually long. Standard is 30 days`,
      UNCLEAR: () => `Initial waiting period not specified`
    },
    roomRent: {
      GREAT: () => `No room rent restrictions — you can choose any room category without worrying about limits`,
      GOOD: () => `Single Private AC room covered, which is industry standard`,
      RED_FLAG: (d) => {
        if (d.hasProportionateDeduction) return `Proportionate deduction of all associated medical expenses when room rent limit is exceeded is a significant cost burden for policyholders`;
        if (d.limitAmount) return `Room rent capped at ₹${d.limitAmount?.toLocaleString()}/day. If actual room costs more, ALL expenses may be reduced proportionally`;
        return `Room rent restrictions could lead to significant out-of-pocket expenses`;
      },
      UNCLEAR: () => `Room rent terms not clearly defined. This is a common source of claim disputes`
    },
    coPay: {
      GREAT: () => `No co-payment — insurer pays 100% of eligible hospital bills`,
      GOOD: (d) => d.isOptional ? `${d.percentage}% co-payment is optional — you chose it for lower premium` : `Co-payment of ${d.percentage}% applies only for senior citizens`,
      RED_FLAG: (d) => {
        if (d.isZoneBased) return `Zone-based co-payment penalizes you for seeking treatment at metro city hospitals`;
        return `Mandatory ${d.percentage}% co-payment on all claims reduces effective coverage significantly`;
      },
      UNCLEAR: () => `Co-payment terms not clear`
    },
    restore: {
      GREAT: (d) => d.sameIllnessCovered ? `Automatic restoration of full sum insured once per year after exhaustion - excellent protection for multiple claims` : `Unlimited restore — sum insured refills every time you exhaust it`,
      GOOD: () => `Restore benefit available for unrelated illnesses. Won't refill for same condition in same year`,
      RED_FLAG: () => `No restore/recharge benefit — once sum insured exhausted, no coverage until renewal`,
      UNCLEAR: () => `Restore benefit details not clear`
    },
    preHospitalization: {
      GREAT: (d) => `${d.days} days pre-hospitalization coverage is excellent for tests and consultations before admission`,
      GOOD: (d) => `${d.days} days pre-hospitalization coverage meets industry standard`,
      RED_FLAG: (d) => `Only ${d.days} days pre-hospitalization may not cover all diagnostic expenses`,
      UNCLEAR: () => `Pre-hospitalization coverage period not specified`
    },
    postHospitalization: {
      GREAT: (d) => `${d.days} days post-discharge coverage is excellent for follow-ups and recovery expenses`,
      GOOD: (d) => `${d.days} days post-hospitalization is standard for follow-up care`,
      RED_FLAG: (d) => `Only ${d.days} days post-discharge may not cover extended recovery needs`,
      UNCLEAR: () => `Post-hospitalization coverage period not specified`
    },
    consumables: {
      GREAT: () => `All consumables and non-medical items covered — gloves, PPE, syringes won't come from your pocket`,
      GOOD: () => `Consumables covered with sub-limits`,
      RED_FLAG: () => `Consumables not covered — expect ₹10,000-50,000 extra on any hospital bill`,
      UNCLEAR: () => `Consumables coverage not specified`
    },
    networkHospitals: {
      GREAT: (d) => `Extensive network of ${d.count?.toLocaleString()}+ hospitals ensures cashless access almost anywhere`,
      GOOD: (d) => `${d.count?.toLocaleString()} hospitals provides good coverage`,
      RED_FLAG: (d) => `Only ${d.count?.toLocaleString()} hospitals — limited options for cashless treatment`,
      UNCLEAR: () => `Network size not specified`
    },
    daycare: {
      GREAT: (d) => `Extensive list of ${d.count}+ day care procedures covered, providing comprehensive outpatient surgical coverage`,
      GOOD: () => `Day care procedures covered as per standard list`,
      RED_FLAG: () => `Limited day care coverage`,
      UNCLEAR: () => `Day care coverage details not specified`
    },
    modernTreatments: {
      GREAT: () => `Comprehensive coverage of modern treatments including robotic surgeries, immunotherapy, and stem cell therapy without sub-limits`,
      GOOD: () => `Modern treatments covered with some limits`,
      RED_FLAG: () => `Modern treatments like robotic surgery may not be covered`,
      UNCLEAR: () => `Coverage for advanced treatments not specified`
    },
    ayush: {
      GREAT: () => `Coverage for alternative medicine systems (Ayurveda, Yoga, Unani, Siddha, Homeopathy) which is valuable in Indian context`,
      GOOD: () => `AYUSH treatments covered with sub-limits`,
      RED_FLAG: () => `AYUSH treatments not covered`,
      UNCLEAR: () => `AYUSH coverage not specified`
    },
    ncb: {
      GREAT: (d) => `${d.percentagePerYear}% cumulative bonus per claim-free year is excellent`,
      GOOD: (d) => `${d.percentagePerYear}% cumulative bonus per claim-free year up to ${d.maxAccumulation || 50}% maximum is good and standard in industry`,
      RED_FLAG: (d) => `Low NCB of ${d.percentagePerYear}% barely increases coverage`,
      UNCLEAR: () => `NCB details not specified`
    },
    globalCoverage: {
      GREAT: () => `Worldwide coverage including planned treatments abroad`,
      GOOD: (d) => `Global coverage with ${d.daysPerTrip || 45} continuous days per trip provides good international protection`,
      RED_FLAG: () => `International coverage very limited`,
      UNCLEAR: () => `International coverage terms not clear`
    }
  };

  const featureExp = explanations[featureId];
  if (!featureExp) return `${featureId}: ${category}`;
  const fn = featureExp[category];
  return fn ? fn(data) : `${featureId}: ${category}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GEMINI API
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini(apiKey: string, prompt: string, content: string, schema: object, maxTokens: number): Promise<any> {
  const { maxRetries, retryDelayMs, backoffMultiplier } = CONFIG.system.api;
  let lastError: Error | null = null;
  let delay = retryDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.system.model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${prompt}\n\n---\n\n${content}` }] }],
            generationConfig: {
              temperature: CONFIG.system.api.temperature,
              maxOutputTokens: maxTokens,
              responseMimeType: "application/json",
              responseSchema: schema
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        if ([400, 401, 403].includes(response.status)) throw new Error(`API error ${response.status}: ${errorText}`);
        throw new Error(`Retryable error ${response.status}`);
      }

      const data = await response.json();
      if (data.candidates?.[0]?.finishReason === 'SAFETY') throw new Error('Content blocked');
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response');
      return JSON.parse(text);
    } catch (error: any) {
      lastError = error;
      if (error.message?.includes('400') || error.message?.includes('401')) throw error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay));
        delay *= backoffMultiplier;
      }
    }
  }
  throw lastError || new Error('API failed');
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const validationSchema = {
  type: "object",
  properties: {
    isHealthInsurance: { type: "boolean" },
    documentType: { type: "string" },
    reason: { type: "string" },
    insurerName: { type: "string" }
  },
  required: ["isHealthInsurance", "documentType", "reason", "insurerName"]
};

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
      },
      required: ["name", "insurer"]
    },
    features: {
      type: "object",
      properties: {
        pedWaiting: { type: "object", properties: { found: { type: "boolean" }, months: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        specificIllnessWaiting: { type: "object", properties: { found: { type: "boolean" }, months: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        initialWaiting: { type: "object", properties: { found: { type: "boolean" }, days: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        roomRent: { type: "object", properties: { found: { type: "boolean" }, rawValue: { type: "string" }, hasLimit: { type: "boolean" }, limitAmount: { type: "number", nullable: true }, limitType: { type: "string" }, hasProportionateDeduction: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "rawValue", "hasLimit", "hasProportionateDeduction", "quote", "reference"] },
        coPay: { type: "object", properties: { found: { type: "boolean" }, percentage: { type: "number", nullable: true }, isOptional: { type: "boolean" }, optionalCoverName: { type: "string", nullable: true }, appliesToAllAges: { type: "boolean" }, isZoneBased: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "isOptional", "appliesToAllAges", "isZoneBased", "quote", "reference"] },
        restore: { type: "object", properties: { found: { type: "boolean" }, available: { type: "boolean" }, sameIllnessCovered: { type: "boolean" }, unlimited: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "available", "sameIllnessCovered", "unlimited", "quote", "reference"] },
        preHospitalization: { type: "object", properties: { found: { type: "boolean" }, days: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        postHospitalization: { type: "object", properties: { found: { type: "boolean" }, days: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        consumables: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, fullyCovered: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "fullyCovered", "quote", "reference"] },
        networkHospitals: { type: "object", properties: { found: { type: "boolean" }, count: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        daycare: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, count: { type: "integer", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        modernTreatments: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, fullyCovered: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        ayush: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, fullyCovered: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        ambulance: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, unlimited: { type: "boolean" }, limit: { type: "number", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        diseaseSubLimits: { type: "object", properties: { found: { type: "boolean" }, hasSubLimits: { type: "boolean" }, details: { type: "string" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "hasSubLimits", "quote", "reference"] },
        ncb: { type: "object", properties: { found: { type: "boolean" }, percentagePerYear: { type: "number", nullable: true }, maxAccumulation: { type: "number", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "quote", "reference"] },
        globalCoverage: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, daysPerTrip: { type: "integer", nullable: true }, hasCoPay: { type: "boolean" }, coPayPercentage: { type: "number", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        domiciliary: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        organDonor: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, fullyCovered: { type: "boolean" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
        maternity: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, waitingMonths: { type: "integer", nullable: true }, amount: { type: "number", nullable: true }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] }
      }
    },
    uniqueFeatures: { type: "array", items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["name", "description", "quote", "reference"] } },
    unclearClauses: { type: "array", items: { type: "object", properties: { name: { type: "string" }, issue: { type: "string" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["name", "issue", "quote", "reference"] } },
    nonStandardExclusions: { type: "array", items: { type: "string" } }
  },
  required: ["policyInfo", "features", "uniqueFeatures", "unclearClauses"]
};

const uniqueJudgmentSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["GREAT", "GOOD", "RED_FLAG"] },
    explanation: { type: "string" }
  },
  required: ["category", "explanation"]
};

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const validationPrompt = `Determine if this is a health insurance policy document from India. Health insurance documents contain: hospitalization, sum insured, cashless, pre-existing disease, waiting period, room rent, IRDAI. NOT health insurance: life insurance, motor insurance, travel insurance, bank statements.`;

const extractionPrompt = `Extract features from this Indian health insurance policy.

RULES:
1. Extract EXACT QUOTES - copy-paste relevant text
2. Include CLAUSE/SECTION REFERENCE (e.g., "Clause 3.1.7", "Section 4.2(a)")
3. Convert years to months (3 years = 36 months)
4. If not found, set found: false

EXTRACT: PED waiting, specific illness waiting, initial waiting, room rent (limits, proportionate deduction), co-pay (%, optional/mandatory, zone-based), restore benefit, pre/post hospitalization days, consumables, network hospitals count, day care, modern treatments, AYUSH, ambulance, disease sub-limits, NCB, global coverage, domiciliary, organ donor, maternity.

UNIQUE FEATURES: Find innovative benefits beyond standard coverage.

UNCLEAR CLAUSES: Flag ambiguous or contradictory terms with exact confusing language.

NON-STANDARD EXCLUSIONS: Only exclusions beyond standard IRDAI list.`;

const uniqueJudgmentPrompt = `Evaluate this health insurance feature:

Feature: {name}
Description: {description}
Quote: "{quote}"

Is this: GREAT (rare, innovative), GOOD (useful but common), or RED_FLAG (hidden catches)?

Give category and 1-2 sentence explanation.`;

// ═══════════════════════════════════════════════════════════════════════════
// MERGE EXTRACTIONS
// ═══════════════════════════════════════════════════════════════════════════

function mergeExtractions(extractions: any[]): any {
  if (extractions.length === 1) return extractions[0];
  const merged = JSON.parse(JSON.stringify(extractions[0]));
  for (const ext of extractions.slice(1)) {
    if (ext.policyInfo) {
      for (const [k, v] of Object.entries(ext.policyInfo)) {
        if (v && v !== "Not specified" && v !== "Unknown") merged.policyInfo[k] = v;
      }
    }
    if (ext.features) {
      for (const [k, v] of Object.entries(ext.features)) {
        const f = v as any;
        if (f?.found && (!merged.features[k]?.found || (f.quote?.length || 0) > (merged.features[k].quote?.length || 0))) {
          merged.features[k] = f;
        }
      }
    }
    const uniqueNames = new Set(merged.uniqueFeatures?.map((f: any) => f.name) || []);
    for (const uf of ext.uniqueFeatures || []) {
      if (!uniqueNames.has(uf.name)) { merged.uniqueFeatures.push(uf); uniqueNames.add(uf.name); }
    }
    const unclearNames = new Set(merged.unclearClauses?.map((c: any) => c.name) || []);
    for (const uc of ext.unclearClauses || []) {
      if (!unclearNames.has(uc.name)) { merged.unclearClauses.push(uc); unclearNames.add(uc.name); }
    }
  }
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startTime = Date.now();
  const log = (msg: string) => console.log(`[${Date.now() - startTime}ms] ${msg}`);

  try {
    const { policyText } = await req.json();

    if (!policyText || policyText.trim().length < CONFIG.system.document.minLength) {
      return new Response(JSON.stringify({ error: 'Document too short. Upload a complete policy.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    log(`Document: ${policyText.length} chars`);

    const docHash = await hashDocument(policyText);
    const cached = getCached(docHash);
    if (cached) { log('Cache hit'); return new Response(JSON.stringify({ ...cached, _cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('API not configured');

    // Validate
    log('Validating...');
    const validation = await callGemini(apiKey, validationPrompt, policyText.substring(0, CONFIG.system.document.validationSample), validationSchema, CONFIG.system.tokens.validation);

    if (!validation.isHealthInsurance) {
      return new Response(JSON.stringify({ error: 'invalid_document', message: `Not a health insurance document. Detected: ${validation.documentType}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Extract
    log('Extracting...');
    const chunks = chunkDocument(policyText);
    let extraction: any;
    if (chunks.length === 1) {
      extraction = await callGemini(apiKey, extractionPrompt, chunks[0], extractionSchema, CONFIG.system.tokens.extraction);
    } else {
      log(`Processing ${chunks.length} chunks...`);
      const exts = [];
      for (let i = 0; i < chunks.length; i++) {
        exts.push(await callGemini(apiKey, extractionPrompt + `\n\nPart ${i + 1} of ${chunks.length}.`, chunks[i], extractionSchema, CONFIG.system.tokens.extraction));
      }
      extraction = mergeExtractions(exts);
    }

    // Classify
    log('Classifying...');
    const features: AnalyzedFeature[] = [];
    const f = extraction.features;

    const add = (id: string, name: string, data: any, classifyFn: () => { category: Category; rule: string }) => {
      if (!data?.found) return;
      const { category, rule } = classifyFn();
      features.push({ name, category, policyStates: data.quote || '', reference: data.reference || '', explanation: generateExplanation(id, data, category), classifiedBy: "code", ruleApplied: rule });
    };

    add('pedWaiting', 'PED Waiting Period', f.pedWaiting, () => classifyPedWaiting(sanitizeNumber(f.pedWaiting?.months, 'months')));
    add('specificIllnessWaiting', 'Specific Illness Waiting Period', f.specificIllnessWaiting, () => classifySpecificIllnessWaiting(sanitizeNumber(f.specificIllnessWaiting?.months, 'months')));
    add('initialWaiting', 'Initial Waiting Period', f.initialWaiting, () => classifyInitialWaiting(sanitizeNumber(f.initialWaiting?.days, 'days')));
    add('roomRent', 'Room Rent', f.roomRent, () => classifyRoomRent(f.roomRent));
    
    if (f.coPay?.found) {
      const r = classifyCoPay(f.coPay);
      features.push({ name: f.coPay.optionalCoverName ? `${f.coPay.optionalCoverName} Co-payment` : 'Co-payment', category: r.category, policyStates: f.coPay.quote || '', reference: f.coPay.reference || '', explanation: generateExplanation('coPay', f.coPay, r.category), classifiedBy: "code", ruleApplied: r.rule });
    }
    
    add('restore', 'Automatic Recharge Benefit', f.restore, () => classifyRestore(f.restore));
    
    if (f.preHospitalization?.found || f.postHospitalization?.found) {
      const preDays = sanitizeNumber(f.preHospitalization?.days, 'days');
      const postDays = sanitizeNumber(f.postHospitalization?.days, 'days');
      const preR = classifyPreHospitalization(preDays);
      const postR = classifyPostHospitalization(postDays);
      const cat = (preR.category === "RED_FLAG" || postR.category === "RED_FLAG") ? "RED_FLAG" : (preR.category === "GOOD" || postR.category === "GOOD") ? "GOOD" : "GREAT";
      features.push({ name: 'Pre and Post Hospitalization Coverage', category: cat as Category, policyStates: f.preHospitalization?.quote || f.postHospitalization?.quote || '', reference: f.preHospitalization?.reference || f.postHospitalization?.reference || '', explanation: `${preDays} days pre and ${postDays} days post hospitalization coverage ${cat === "GOOD" ? "meets industry standard" : cat === "GREAT" ? "is excellent" : "is below standard"}`, classifiedBy: "code", ruleApplied: `Pre ${preDays}, Post ${postDays}` });
    }
    
    add('consumables', 'Consumables Coverage', f.consumables, () => classifyConsumables(f.consumables));
    add('networkHospitals', 'Cashless Hospital Network', f.networkHospitals, () => classifyNetworkHospitals(sanitizeNumber(f.networkHospitals?.count, 'count')));
    add('daycare', 'Day Care Procedures', f.daycare, () => classifyDaycare(f.daycare));
    
    if (f.modernTreatments?.found && f.modernTreatments?.covered) {
      features.push({ name: 'Advanced Technology Methods Coverage', category: f.modernTreatments.fullyCovered ? "GREAT" : "GOOD", policyStates: f.modernTreatments.quote || '', reference: f.modernTreatments.reference || '', explanation: generateExplanation('modernTreatments', f.modernTreatments, f.modernTreatments.fullyCovered ? "GREAT" : "GOOD"), classifiedBy: "code" });
    }
    
    if (f.ayush?.found && f.ayush?.covered) {
      features.push({ name: 'AYUSH Treatments Coverage', category: f.ayush.fullyCovered ? "GREAT" : "GOOD", policyStates: f.ayush.quote || '', reference: f.ayush.reference || '', explanation: generateExplanation('ayush', f.ayush, f.ayush.fullyCovered ? "GREAT" : "GOOD"), classifiedBy: "code" });
    }
    
    add('ncb', 'No Claims Bonus Structure', f.ncb, () => classifyNcb(f.ncb?.percentagePerYear, f.ncb?.maxAccumulation));
    
    if (f.globalCoverage?.found && f.globalCoverage?.covered) {
      features.push({ name: 'Global Coverage Option', category: "GOOD", policyStates: f.globalCoverage.quote || '', reference: f.globalCoverage.reference || '', explanation: generateExplanation('globalCoverage', f.globalCoverage, "GOOD"), classifiedBy: "code" });
      if (f.globalCoverage.hasCoPay && f.globalCoverage.coPayPercentage) {
        features.push({ name: 'Co-payment for Global Coverage', category: "RED_FLAG", policyStates: f.globalCoverage.quote || '', reference: f.globalCoverage.reference || '', explanation: `Mandatory ${f.globalCoverage.coPayPercentage}% co-payment on all international claims reduces effective coverage significantly`, classifiedBy: "code" });
      }
    }
    
    if (f.diseaseSubLimits?.found && f.diseaseSubLimits?.hasSubLimits) {
      features.push({ name: 'Disease-wise Sub-Limits', category: "RED_FLAG", policyStates: f.diseaseSubLimits.quote || '', reference: f.diseaseSubLimits.reference || '', explanation: `Disease sub-limits: ${f.diseaseSubLimits.details}. Actual costs often exceed these caps`, classifiedBy: "code" });
    }
    
    if (f.roomRent?.hasProportionateDeduction) {
      features.push({ name: 'Room Rent Proportionate Deduction', category: "RED_FLAG", policyStates: f.roomRent.quote || '', reference: f.roomRent.reference || '', explanation: 'Proportionate deduction of all associated medical expenses when room rent limit is exceeded is a significant cost burden for policyholders', classifiedBy: "code" });
    }

    // Unique features
    for (const uf of extraction.uniqueFeatures || []) {
      if (!validateQuote(uf.quote, policyText)) continue;
      try {
        const j = await callGemini(apiKey, uniqueJudgmentPrompt.replace('{name}', uf.name).replace('{description}', uf.description).replace('{quote}', uf.quote), '', uniqueJudgmentSchema, CONFIG.system.tokens.judgment);
        features.push({ name: uf.name, category: j.category as Category, policyStates: uf.quote, reference: uf.reference, explanation: j.explanation, classifiedBy: "llm" });
      } catch (e) { log(`Error: ${e}`); }
    }

    // Unclear
    for (const uc of extraction.unclearClauses || []) {
      features.push({ name: uc.name, category: "UNCLEAR", policyStates: uc.quote, reference: uc.reference, explanation: uc.issue, classifiedBy: "llm" });
    }

    // Build response
    const great = features.filter(f => f.category === "GREAT");
    const good = features.filter(f => f.category === "GOOD");
    const redFlags = features.filter(f => f.category === "RED_FLAG");
    const unclear = features.filter(f => f.category === "UNCLEAR");

    const fmt = (arr: AnalyzedFeature[]) => arr.map(f => ({ name: f.name, policyStates: f.policyStates, reference: f.reference, explanation: f.explanation }));

    const result = {
      policyName: extraction.policyInfo?.name || 'Unknown Policy',
      insurer: extraction.policyInfo?.insurer || validation.insurerName || 'Unknown',
      sumInsured: extraction.policyInfo?.sumInsured || 'Not specified',
      policyType: extraction.policyInfo?.policyType || 'Not specified',
      summary: { great: great.length, good: good.length, redFlags: redFlags.length, unclear: unclear.length },
      greatFeatures: fmt(great),
      goodFeatures: fmt(good),
      redFlags: fmt(redFlags),
      needsClarification: fmt(unclear),
      disclaimer: "This analysis is for informational purposes. Standard IRDAI exclusions apply. Verify with insurer before purchase.",
      _meta: { processingTimeMs: Date.now() - startTime, documentHash: docHash.substring(0, 16), version: CONFIG.system.version, model: CONFIG.system.model }
    };

    setCache(docHash, result);
    log(`Done: ${great.length} great, ${good.length} good, ${redFlags.length} red flags, ${unclear.length} unclear`);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: getUserFriendlyError(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
