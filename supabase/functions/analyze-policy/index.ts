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
    version: "3.1.0",
    api: {
      maxRetries: 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2,
      temperature: 0.1
    },
    tokens: {
      validation: 500,
      extraction: 16384,  // Increased from 8192 to handle large responses
      judgment: 800,
      explanations: 4096  // Increased from 2048
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

  // Keywords for code-based validation
  validation: {
    healthKeywords: [
      // Core terms
      'health insurance', 'hospitalization', 'hospitalisation', 'sum insured', 'cashless',
      // Waiting periods
      'waiting period', 'pre-existing', 'preexisting', 'pre existing',
      // Room & facilities  
      'room rent', 'network hospital', 'empanelled hospital', 'panel hospital',
      // Regulatory
      'irdai', 'irda', 'tpa', 'third party administrator',
      // Patient types
      'in-patient', 'inpatient', 'in patient', 'out-patient', 'outpatient',
      // Day care
      'day care', 'daycare', 'day-care',
      // Co-payment (multiple variations)
      'co-pay', 'copay', 'co-payment', 'copayment', 'co payment',
      // Claims
      'claim settlement', 'cashless claim', 'reimbursement claim',
      // Products
      'mediclaim', 'medical expenses', 'hospital cash', 'critical illness',
      // Pre/post hospital
      'pre-hospitalization', 'post-hospitalization', 'prehospitalization', 'posthospitalization',
      'pre hospitalization', 'post hospitalization',
      // Other indicators
      'policy holder', 'policyholder', 'insured person', 'coverage', 'exclusion',
      'deductible', 'sub-limit', 'sublimit', 'no claim bonus', 'cumulative bonus'
    ],
    wrongDocKeywords: [
      'life insurance', 'term plan', 'death benefit', 'maturity benefit', 'endowment',
      'motor insurance', 'vehicle insurance', 'car insurance', 'two wheeler',
      'travel insurance', 'trip cancellation', 'baggage loss',
      'home insurance', 'fire insurance', 'property insurance',
      'bank statement', 'account summary', 'transaction history', 'ifsc code',
      'resume', 'curriculum vitae', 'work experience', 'education qualification',
      'invoice', 'bill of supply', 'gst number'
    ],
    minHealthKeywords: 4,  // Lowered from 5
    minWrongKeywords: 2
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

interface ClassifiedFeature {
  id: string;
  name: string;
  category: Category;
  value: string;
  quote: string;
  reference: string;
  ruleApplied: string;
  explanation?: string;
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
// HYBRID VALIDATION (Code first, Gemini fallback)
// ═══════════════════════════════════════════════════════════════════════════

interface ValidationResult {
  isValid: boolean;
  isHealthInsurance: boolean;
  documentType: string;
  reason: string;
  method: 'code' | 'gemini';
}

function validateWithCode(text: string): { 
  definitelyValid: boolean; 
  definitelyInvalid: boolean; 
  reason: string;
  documentType: string;
} {
  // Normalize text: replace various dashes with hyphen, normalize whitespace
  const normalized = text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')  // Various dash chars to hyphen
    .replace(/\s+/g, ' ');  // Normalize whitespace
  
  const { healthKeywords, wrongDocKeywords, minHealthKeywords, minWrongKeywords } = CONFIG.validation;
  
  const healthMatches = healthKeywords.filter(kw => normalized.includes(kw));
  const wrongMatches = wrongDocKeywords.filter(kw => normalized.includes(kw));
  
  console.log(`Validation: Found ${healthMatches.length} health keywords: ${healthMatches.slice(0, 5).join(', ')}...`);
  
  // Definitely wrong document type
  if (wrongMatches.length >= minWrongKeywords) {
    let docType = 'Unknown';
    if (wrongMatches.some(w => w.includes('life') || w.includes('death') || w.includes('term plan'))) {
      docType = 'Life Insurance';
    } else if (wrongMatches.some(w => w.includes('motor') || w.includes('vehicle') || w.includes('car'))) {
      docType = 'Motor Insurance';
    } else if (wrongMatches.some(w => w.includes('travel') || w.includes('trip'))) {
      docType = 'Travel Insurance';
    } else if (wrongMatches.some(w => w.includes('bank') || w.includes('transaction') || w.includes('ifsc'))) {
      docType = 'Bank Statement';
    } else if (wrongMatches.some(w => w.includes('resume') || w.includes('vitae') || w.includes('experience'))) {
      docType = 'Resume/CV';
    } else if (wrongMatches.some(w => w.includes('invoice') || w.includes('gst'))) {
      docType = 'Invoice/Bill';
    }
    
    return { 
      definitelyValid: false, 
      definitelyInvalid: true, 
      reason: `Detected ${docType.toLowerCase()} keywords: ${wrongMatches.slice(0, 3).join(', ')}`,
      documentType: docType
    };
  }
  
  // Definitely health insurance (6+ keywords = confident)
  if (healthMatches.length >= minHealthKeywords + 2) {
    return { 
      definitelyValid: true, 
      definitelyInvalid: false, 
      reason: `Found ${healthMatches.length} health insurance keywords: ${healthMatches.slice(0, 5).join(', ')}`,
      documentType: 'Health Insurance'
    };
  }
  
  // Uncertain - might be health insurance but not confident
  if (healthMatches.length >= 3) {
    return { 
      definitelyValid: false, 
      definitelyInvalid: false, 
      reason: `Found only ${healthMatches.length} health keywords, need confirmation`,
      documentType: 'Possibly Health Insurance'
    };
  }
  
  // Too few keywords - likely not health insurance
  return { 
    definitelyValid: false, 
    definitelyInvalid: true, 
    reason: `Only ${healthMatches.length} health insurance keywords found`,
    documentType: 'Unknown Document'
  };
}

async function validateDocument(
  text: string, 
  apiKey: string,
  log: (msg: string) => void
): Promise<ValidationResult> {
  // Step 1: Quick code check (FREE, instant)
  const codeCheck = validateWithCode(text.substring(0, CONFIG.system.document.validationSample));
  
  if (codeCheck.definitelyInvalid) {
    log(`Code validation: INVALID (${codeCheck.documentType})`);
    return { 
      isValid: false, 
      isHealthInsurance: false,
      documentType: codeCheck.documentType,
      reason: codeCheck.reason,
      method: 'code'
    };
  }
  
  if (codeCheck.definitelyValid) {
    log(`Code validation: VALID (confident)`);
    return { 
      isValid: true, 
      isHealthInsurance: true,
      documentType: 'Health Insurance Policy',
      reason: codeCheck.reason,
      method: 'code'
    };
  }
  
  // Step 2: Uncertain - use Gemini (~10-20% of documents)
  log(`Code validation: UNCERTAIN, using Gemini...`);
  
  const geminiResult = await callGemini(
    apiKey,
    `Determine if this is a health insurance policy document from India.
    
Health insurance documents contain: hospitalization, sum insured, cashless, pre-existing disease, waiting period, room rent, IRDAI, TPA, network hospitals.

NOT health insurance: life insurance, motor insurance, travel insurance, home insurance, bank statements, resumes, invoices.

Respond with whether this is a health insurance document and why.`,
    text.substring(0, CONFIG.system.document.validationSample),
    {
      type: "object",
      properties: {
        isHealthInsurance: { type: "boolean" },
        documentType: { type: "string" },
        reason: { type: "string" }
      },
      required: ["isHealthInsurance", "documentType", "reason"]
    },
    CONFIG.system.tokens.validation
  );
  
  return {
    isValid: geminiResult.isHealthInsurance,
    isHealthInsurance: geminiResult.isHealthInsurance,
    documentType: geminiResult.documentType,
    reason: geminiResult.reason,
    method: 'gemini'
  };
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
            contents: [{ parts: [{ text: content ? `${prompt}\n\n---\n\n${content}` : prompt }] }],
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
        console.error(`Gemini API error ${response.status}:`, errorText.substring(0, 500));
        if ([400, 401, 403].includes(response.status)) throw new Error(`API error ${response.status}: ${errorText}`);
        throw new Error(`Retryable error ${response.status}`);
      }
      
      const data = await response.json();
      const finishReason = data.candidates?.[0]?.finishReason;
      
      if (finishReason === 'SAFETY') {
        console.error('Content blocked by safety filter');
        throw new Error('Content blocked');
      }
      
      if (finishReason === 'MAX_TOKENS') {
        console.warn('Response truncated due to MAX_TOKENS, increasing limit and retrying...');
        // Retry with higher token limit on next attempt
        throw new Error('Response truncated');
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.error('Empty response from Gemini:', JSON.stringify(data).substring(0, 500));
        throw new Error('Empty response');
      }
      
      // Try to parse JSON, with fallback for truncated responses
      try {
        return JSON.parse(text);
      } catch (parseError) {
        console.error('JSON parse error. Response length:', text.length);
        console.error('Response preview:', text.substring(0, 500));
        console.error('Response end:', text.substring(Math.max(0, text.length - 200)));
        
        // Try to fix common truncation issues
        let fixedText = text;
        
        // If it ends mid-string, try to close it
        const lastQuoteIndex = text.lastIndexOf('"');
        const lastBraceIndex = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
        
        if (lastQuoteIndex > lastBraceIndex) {
          // Truncated in middle of a string - try to fix
          fixedText = text.substring(0, lastQuoteIndex + 1);
          // Count open braces/brackets and close them
          const openBraces = (fixedText.match(/{/g) || []).length;
          const closeBraces = (fixedText.match(/}/g) || []).length;
          const openBrackets = (fixedText.match(/\[/g) || []).length;
          const closeBrackets = (fixedText.match(/]/g) || []).length;
          
          for (let i = 0; i < openBrackets - closeBrackets; i++) fixedText += ']';
          for (let i = 0; i < openBraces - closeBraces; i++) fixedText += '}';
          
          try {
            console.log('Fixed truncated JSON, retrying parse...');
            return JSON.parse(fixedText);
          } catch (e) {
            // Still failed, throw original error
          }
        }
        
        throw parseError;
      }
    } catch (error: any) {
      lastError = error;
      console.error(`Gemini attempt ${attempt} failed:`, error.message);
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
        modernTreatments: { type: "object", properties: { found: { type: "boolean" }, covered: { type: "boolean" }, fullyCovered: { type: "boolean" }, treatmentsList: { type: "string" }, quote: { type: "string" }, reference: { type: "string" } }, required: ["found", "covered", "quote", "reference"] },
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
    reasoning: { type: "string" }
  },
  required: ["category", "reasoning"]
};

const explanationsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      explanation: { type: "string" }
    },
    required: ["name", "explanation"]
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const extractionPrompt = `Extract features from this Indian health insurance policy.

RULES:
1. Extract EXACT QUOTES - copy-paste relevant text from the policy
2. Include CLAUSE/SECTION REFERENCE (e.g., "Clause 3.1.7", "Section 4.2(a)")
3. Convert years to months (3 years = 36 months)
4. If not found, set found: false

EXTRACT: PED waiting, specific illness waiting, initial waiting, room rent (limits, proportionate deduction), co-pay (%, optional/mandatory, zone-based), restore benefit, pre/post hospitalization days, consumables, network hospitals count, day care, modern treatments, AYUSH, ambulance, disease sub-limits, NCB, global coverage, domiciliary, organ donor, maternity.

UNIQUE FEATURES: Find any innovative benefits beyond standard coverage that make this policy special.

UNCLEAR CLAUSES: Flag any ambiguous, contradictory, or confusing terms with the exact problematic language.

NON-STANDARD EXCLUSIONS: Only list exclusions that go beyond standard IRDAI exclusions.`;

const explanationsPrompt = `Write customer-friendly explanations for each health insurance feature.

RULES:
1. Write 1-2 clear sentences explaining what this means for the customer
2. Use the exact values from the policy (months, days, percentages)
3. Reference the policy quote where helpful
4. For GREAT features: Explain why this is better than typical policies
5. For GOOD features: Explain this is standard/acceptable
6. For RED_FLAG: Clearly explain the risk or downside
7. For UNCLEAR: Explain what's confusing and what the customer should verify
8. Be direct and helpful, not promotional
9. Use simple language a non-expert can understand

FEATURES TO EXPLAIN:`;

const uniqueJudgmentPrompt = `Evaluate this health insurance feature:

Feature: {name}
Description: {description}
Quote: "{quote}"

Is this: GREAT (rare, innovative, significantly benefits customer), GOOD (useful but common), or RED_FLAG (has hidden catches/restrictions)?

Give category and 1-2 sentence reasoning.`;

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
// GENERATE EXPLANATIONS (Gemini batch call)
// ═══════════════════════════════════════════════════════════════════════════

async function generateExplanations(
  apiKey: string,
  features: ClassifiedFeature[],
  log: (msg: string) => void
): Promise<Map<string, string>> {
  if (features.length === 0) return new Map();
  
  log(`Generating explanations for ${features.length} features...`);
  
  const featureDescriptions = features.map(f => 
    `- ${f.name} [${f.category}]
  Value: ${f.value}
  Quote: "${f.quote.substring(0, 200)}${f.quote.length > 200 ? '...' : ''}"
  Reference: ${f.reference}`
  ).join('\n\n');
  
  const explanations = await callGemini(
    apiKey,
    explanationsPrompt + '\n\n' + featureDescriptions,
    '',
    explanationsSchema,
    CONFIG.system.tokens.explanations
  );
  
  const explanationMap = new Map<string, string>();
  for (const exp of explanations) {
    explanationMap.set(exp.name, exp.explanation);
  }
  
  log(`Generated ${explanationMap.size} explanations`);
  return explanationMap;
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
    
    // Check cache
    const docHash = await hashDocument(policyText);
    const cached = getCached(docHash);
    if (cached) { 
      log('Cache hit'); 
      return new Response(JSON.stringify({ ...cached, _cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); 
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) throw new Error('API not configured');

    // Step 1: Hybrid Validation (code first, Gemini fallback)
    log('Validating...');
    const validation = await validateDocument(policyText, apiKey, log);
    
    if (!validation.isHealthInsurance) {
      return new Response(JSON.stringify({ 
        error: 'invalid_document', 
        message: `Not a health insurance document. Detected: ${validation.documentType}. ${validation.reason}`,
        validationMethod: validation.method
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 2: Extract features
    log('Extracting features...');
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

    log(`Extracted: ${extraction.uniqueFeatures?.length || 0} unique features, ${extraction.unclearClauses?.length || 0} unclear clauses`);

    // Step 3: Classify with code
    log('Classifying...');
    const classifiedFeatures: ClassifiedFeature[] = [];
    const f = extraction.features;

    const addFeature = (id: string, name: string, data: any, classifyFn: () => { category: Category; rule: string }, value: string) => {
      if (!data?.found) return;
      const { category, rule } = classifyFn();
      classifiedFeatures.push({ id, name, category, value, quote: data.quote || '', reference: data.reference || '', ruleApplied: rule });
    };

    // Standard features
    addFeature('pedWaiting', 'PED Waiting Period', f.pedWaiting, () => classifyPedWaiting(sanitizeNumber(f.pedWaiting?.months, 'months')), `${f.pedWaiting?.months || '?'} months`);
    addFeature('specificIllnessWaiting', 'Specific Illness Waiting Period', f.specificIllnessWaiting, () => classifySpecificIllnessWaiting(sanitizeNumber(f.specificIllnessWaiting?.months, 'months')), `${f.specificIllnessWaiting?.months || '?'} months`);
    addFeature('initialWaiting', 'Initial Waiting Period', f.initialWaiting, () => classifyInitialWaiting(sanitizeNumber(f.initialWaiting?.days, 'days')), `${f.initialWaiting?.days || '?'} days`);
    addFeature('roomRent', 'Room Rent', f.roomRent, () => classifyRoomRent(f.roomRent), f.roomRent?.rawValue || 'Not specified');
    
    if (f.coPay?.found) {
      const r = classifyCoPay(f.coPay);
      classifiedFeatures.push({ id: 'coPay', name: f.coPay.optionalCoverName ? `${f.coPay.optionalCoverName} Co-payment` : 'Co-payment', category: r.category, value: `${f.coPay.percentage || 0}%${f.coPay.isOptional ? ' (optional)' : ''}`, quote: f.coPay.quote || '', reference: f.coPay.reference || '', ruleApplied: r.rule });
    }
    
    addFeature('restore', 'Automatic Recharge Benefit', f.restore, () => classifyRestore(f.restore), f.restore?.sameIllnessCovered ? 'Same illness covered' : 'Different illness only');
    
    // Pre + Post hospitalization combined
    if (f.preHospitalization?.found || f.postHospitalization?.found) {
      const preDays = sanitizeNumber(f.preHospitalization?.days, 'days');
      const postDays = sanitizeNumber(f.postHospitalization?.days, 'days');
      const preR = classifyPreHospitalization(preDays);
      const postR = classifyPostHospitalization(postDays);
      const cat: Category = (preR.category === "RED_FLAG" || postR.category === "RED_FLAG") ? "RED_FLAG" : (preR.category === "GOOD" || postR.category === "GOOD") ? "GOOD" : "GREAT";
      classifiedFeatures.push({ id: 'prePostHosp', name: 'Pre and Post Hospitalization Coverage', category: cat, value: `Pre: ${preDays || '?'} days, Post: ${postDays || '?'} days`, quote: f.preHospitalization?.quote || f.postHospitalization?.quote || '', reference: f.preHospitalization?.reference || f.postHospitalization?.reference || '', ruleApplied: `Pre ${preDays}, Post ${postDays}` });
    }
    
    addFeature('consumables', 'Consumables Coverage', f.consumables, () => classifyConsumables(f.consumables), f.consumables?.fullyCovered ? 'Fully covered' : 'With sub-limit');
    addFeature('networkHospitals', 'Cashless Hospital Network', f.networkHospitals, () => classifyNetworkHospitals(sanitizeNumber(f.networkHospitals?.count, 'count')), `${f.networkHospitals?.count || '?'} hospitals`);
    addFeature('daycare', 'Day Care Procedures', f.daycare, () => classifyDaycare(f.daycare), f.daycare?.count ? `${f.daycare.count}+ procedures` : 'Covered');
    
    if (f.modernTreatments?.found && f.modernTreatments?.covered) {
      classifiedFeatures.push({ id: 'modernTreatments', name: 'Advanced Technology Methods Coverage', category: f.modernTreatments.fullyCovered ? "GREAT" : "GOOD", value: f.modernTreatments.treatmentsList || 'Various treatments', quote: f.modernTreatments.quote || '', reference: f.modernTreatments.reference || '', ruleApplied: f.modernTreatments.fullyCovered ? "Modern treatments fully covered" : "Modern treatments with limits" });
    }
    
    if (f.ayush?.found && f.ayush?.covered) {
      classifiedFeatures.push({ id: 'ayush', name: 'AYUSH Treatments Coverage', category: f.ayush.fullyCovered ? "GREAT" : "GOOD", value: f.ayush.fullyCovered ? 'Full sum insured' : 'With sub-limit', quote: f.ayush.quote || '', reference: f.ayush.reference || '', ruleApplied: "AYUSH covered" });
    }
    
    addFeature('ncb', 'No Claims Bonus Structure', f.ncb, () => classifyNcb(f.ncb?.percentagePerYear, f.ncb?.maxAccumulation), `${f.ncb?.percentagePerYear || '?'}% per year, max ${f.ncb?.maxAccumulation || '?'}%`);
    
    if (f.globalCoverage?.found && f.globalCoverage?.covered) {
      classifiedFeatures.push({ id: 'globalCoverage', name: 'Global Coverage Option', category: "GOOD", value: `${f.globalCoverage.daysPerTrip || '?'} days per trip`, quote: f.globalCoverage.quote || '', reference: f.globalCoverage.reference || '', ruleApplied: "Global coverage available" });
      if (f.globalCoverage.hasCoPay && f.globalCoverage.coPayPercentage) {
        classifiedFeatures.push({ id: 'globalCoPay', name: 'Co-payment for Global Coverage', category: "RED_FLAG", value: `${f.globalCoverage.coPayPercentage}%`, quote: f.globalCoverage.quote || '', reference: f.globalCoverage.reference || '', ruleApplied: `Global co-pay ${f.globalCoverage.coPayPercentage}%` });
      }
    }
    
    if (f.diseaseSubLimits?.found && f.diseaseSubLimits?.hasSubLimits) {
      classifiedFeatures.push({ id: 'diseaseSubLimits', name: 'Disease-wise Sub-Limits', category: "RED_FLAG", value: f.diseaseSubLimits.details || 'Sub-limits present', quote: f.diseaseSubLimits.quote || '', reference: f.diseaseSubLimits.reference || '', ruleApplied: "Disease sub-limits reduce coverage" });
    }
    
    if (f.roomRent?.hasProportionateDeduction) {
      classifiedFeatures.push({ id: 'proportionateDeduction', name: 'Room Rent Proportionate Deduction', category: "RED_FLAG", value: 'All expenses reduced proportionally', quote: f.roomRent.quote || '', reference: f.roomRent.reference || '', ruleApplied: "Proportionate deduction clause" });
    }

    // Step 4: Judge unique features
    for (const uf of extraction.uniqueFeatures || []) {
      if (!validateQuote(uf.quote, policyText)) continue;
      try {
        const j = await callGemini(apiKey, uniqueJudgmentPrompt.replace('{name}', uf.name).replace('{description}', uf.description).replace('{quote}', uf.quote), '', uniqueJudgmentSchema, CONFIG.system.tokens.judgment);
        classifiedFeatures.push({ id: `unique_${uf.name}`, name: uf.name, category: j.category as Category, value: uf.description, quote: uf.quote, reference: uf.reference, ruleApplied: j.reasoning });
      } catch (e) { log(`Error judging unique feature: ${e}`); }
    }

    // Step 5: Add unclear clauses
    for (const uc of extraction.unclearClauses || []) {
      classifiedFeatures.push({ id: `unclear_${uc.name}`, name: uc.name, category: "UNCLEAR", value: uc.issue, quote: uc.quote, reference: uc.reference, ruleApplied: "Needs clarification" });
    }

    log(`Classified ${classifiedFeatures.length} features`);

    // Step 6: Generate explanations with Gemini (batch call)
    const explanationMap = await generateExplanations(apiKey, classifiedFeatures, log);
    
    // Merge explanations into features
    for (const feature of classifiedFeatures) {
      feature.explanation = explanationMap.get(feature.name) || `${feature.name}: ${feature.value}`;
    }

    // Step 7: Build response
    const great = classifiedFeatures.filter(f => f.category === "GREAT");
    const good = classifiedFeatures.filter(f => f.category === "GOOD");
    const redFlags = classifiedFeatures.filter(f => f.category === "RED_FLAG");
    const unclear = classifiedFeatures.filter(f => f.category === "UNCLEAR");

    const fmt = (arr: ClassifiedFeature[]) => arr.map(f => ({ 
      name: f.name, 
      policyStates: f.quote, 
      reference: f.reference, 
      explanation: f.explanation || f.value 
    }));

    const result = {
      policyName: extraction.policyInfo?.name || 'Unknown Policy',
      insurer: extraction.policyInfo?.insurer || 'Unknown',
      sumInsured: extraction.policyInfo?.sumInsured || 'Not specified',
      policyType: extraction.policyInfo?.policyType || 'Not specified',
      summary: { great: great.length, good: good.length, redFlags: redFlags.length, unclear: unclear.length },
      greatFeatures: fmt(great),
      goodFeatures: fmt(good),
      redFlags: fmt(redFlags),
      needsClarification: fmt(unclear),
      disclaimer: "This analysis is for informational purposes. Standard IRDAI exclusions apply. Verify all details with your insurer before purchase.",
      _meta: { 
        processingTimeMs: Date.now() - startTime, 
        documentHash: docHash.substring(0, 16), 
        version: CONFIG.system.version, 
        model: CONFIG.system.model,
        validationMethod: validation.method
      }
    };

    setCache(docHash, result);
    log(`Done: ${great.length} great, ${good.length} good, ${redFlags.length} red flags, ${unclear.length} unclear`);

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: getUserFriendlyError(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
