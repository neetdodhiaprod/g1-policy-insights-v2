import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: CONFIGURATION - ALL THRESHOLDS AND RULES IN ONE PLACE
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // ─────────────────────────────────────────────────────────────────────────
  // CLASSIFICATION THRESHOLDS - EDIT THESE TO CHANGE BUSINESS RULES
  // ─────────────────────────────────────────────────────────────────────────
  
  thresholds: {
    pedWaiting: {
      great: { maxMonths: 23 },      // < 24 months = GREAT
      good: { maxMonths: 36 },       // 24-36 months = GOOD (CHANGED: was 48)
      bad: { minMonths: 37 }         // > 36 months = BAD (CHANGED: was >48)
    },
    
    specificIllnessWaiting: {
      great: { maxMonths: 23 },      // < 24 months = GREAT
      good: { maxMonths: 24 },       // 24 months = GOOD
      bad: { minMonths: 25 }         // > 24 months = BAD
    },
    
    initialWaiting: {
      great: { maxDays: 0 },         // 0 days = GREAT
      good: { maxDays: 30 },         // 1-30 days = GOOD
      bad: { minDays: 31 }           // > 30 days = BAD
    },
    
    preHospitalization: {
      great: { minDays: 60 },        // >= 60 days = GREAT
      good: { minDays: 30 },         // 30-59 days = GOOD
      bad: { maxDays: 29 }           // < 30 days = BAD
    },
    
    postHospitalization: {
      great: { minDays: 180 },       // >= 180 days = GREAT
      good: { minDays: 60 },         // 60-179 days = GOOD
      bad: { maxDays: 59 }           // < 60 days = BAD
    },
    
    coPay: {
      great: { maxPercentage: 0 },   // 0% = GREAT
      good: { maxPercentage: 20 },   // 1-20% (seniors only or optional) = GOOD
      bad: { minPercentage: 21 }     // > 20% or mandatory all ages = BAD
    },
    
    networkHospitals: {
      great: { minCount: 10001 },    // > 10,000 = GREAT
      good: { minCount: 7000 },      // 7,000-10,000 = GOOD
      bad: { maxCount: 6999 }        // < 7,000 = BAD
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SANITY BOUNDS FOR NUMERIC EXTRACTION
  // ─────────────────────────────────────────────────────────────────────────
  
  sanityBounds: {
    months: { min: 0, max: 120 },    // 0-10 years
    days: { min: 0, max: 365 },      // 0-1 year
    percentage: { min: 0, max: 100 },
    hospitalCount: { min: 0, max: 100000 },
    amount: { min: 0, max: 100000000 } // Up to 10 crore
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STANDARD IRDAI EXCLUSIONS - DO NOT FLAG THESE
  // ─────────────────────────────────────────────────────────────────────────
  
  standardIrdaiExclusions: [
    // Maternity & Reproductive
    "maternity", "pregnancy", "childbirth", "cesarean", "c-section",
    "infertility", "sterility", "ivf", "assisted reproduction",
    
    // Cosmetic & Elective
    "cosmetic", "plastic surgery", "aesthetic", "beauty treatment",
    "obesity", "weight control", "bariatric", "weight loss surgery",
    "dental", "orthodontic", "teeth", "gum",
    "spectacles", "contact lenses", "lasik", "refractive error",
    "hearing aids", "cochlear",
    
    // Self-inflicted & Behavioral
    "self-inflicted", "self-harm", "suicide", "attempted suicide",
    "alcoholism", "alcohol abuse", "drug abuse", "substance abuse",
    "intoxication", "drunken",
    "hazardous sports", "adventure sports", "extreme sports",
    "breach of law", "criminal activity", "illegal act",
    
    // War & Catastrophe
    "war", "invasion", "act of foreign enemy", "hostilities",
    "terrorism", "terrorist", "nuclear", "radiation", "radioactive",
    "chemical weapon", "biological weapon",
    
    // Congenital & Genetic
    "congenital", "birth defect", "genetic disorder",
    "hereditary", "chromosome",
    
    // Other Standard
    "hiv", "aids", "std", "sexually transmitted",
    "vaccination", "immunization", "prophylactic",
    "vitamins", "tonics", "supplements", "health food",
    "rest cure", "sanatorium", "rehabilitation",
    "experimental", "unproven", "investigational",
    "change of gender", "sex change", "gender reassignment",
    "sleep apnea", "snoring", "sleep disorder",
    "alternative medicine" // unless AYUSH
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // DOCUMENT PROCESSING
  // ─────────────────────────────────────────────────────────────────────────
  
  chunking: {
    maxCharsPerChunk: 100000,        // ~25K tokens
    overlapChars: 2000,              // Overlap between chunks
    maxChunks: 5                     // Max chunks to process
  },

  // ─────────────────────────────────────────────────────────────────────────
  // API SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  
  api: {
    maxRetries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2
  },

  // ─────────────────────────────────────────────────────────────────────────
  // CACHE SETTINGS
  // ─────────────────────────────────────────────────────────────────────────
  
  cache: {
    enabled: true,
    ttlSeconds: 86400 * 7  // 7 days
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

type Category = "GREAT" | "GOOD" | "BAD" | "UNCLEAR";

interface ExtractedFeature {
  found: boolean;
  rawValue: string;
  quote: string;
  reference: string;
  confidence: "high" | "medium" | "low";
}

interface NumericFeature extends ExtractedFeature {
  extractedNumber: number | null;
  validatedNumber: number | null;
  validationMethod: "llm" | "regex" | "both" | "failed";
}

interface RoomRentFeature extends ExtractedFeature {
  hasLimit: boolean;
  limitAmount: number | null;
  limitType: "daily_cap" | "percentage" | "none";
  hasProportionateDeduction: boolean;
}

interface WaitingPeriodFeature extends NumericFeature {
  months: number | null;
  days: number | null;
}

interface CoPayFeature extends NumericFeature {
  percentage: number | null;
  isOptional: boolean;
  appliesToAllAges: boolean;
  isZoneBased: boolean;
  optionalCoverName: string | null;
}

interface RestoreFeature extends ExtractedFeature {
  available: boolean;
  sameIllnessCovered: boolean;
  unlimited: boolean;
  percentageRestore: number | null;
}

interface CoverageFeature extends ExtractedFeature {
  covered: boolean;
  fullyCovered: boolean;
  limit: number | null;
  hasSubLimit: boolean;
}

interface UniqueFeature {
  name: string;
  rawValue: string;
  quote: string;
  reference: string;
}

interface ClassifiedFeature {
  name: string;
  category: Category;
  value: string;
  quote: string;
  reference: string;
  explanation?: string;
  classifiedBy: "code" | "llm";
  ruleApplied: string;
  quoteValidated: boolean;
}

interface CacheEntry {
  result: any;
  timestamp: number;
  version: string;
}

// Simple in-memory cache (in production, use Redis or Supabase)
const cache = new Map<string, CacheEntry>();
const CACHE_VERSION = "1.0.0";

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Hash document for caching
async function hashDocument(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase().replace(/\s+/g, ' '));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check cache
function getCachedResult(hash: string): any | null {
  if (!CONFIG.cache.enabled) return null;
  
  const entry = cache.get(hash);
  if (!entry) return null;
  
  // Check version
  if (entry.version !== CACHE_VERSION) {
    cache.delete(hash);
    return null;
  }
  
  // Check TTL
  const age = (Date.now() - entry.timestamp) / 1000;
  if (age > CONFIG.cache.ttlSeconds) {
    cache.delete(hash);
    return null;
  }
  
  return entry.result;
}

// Set cache
function setCachedResult(hash: string, result: any): void {
  if (!CONFIG.cache.enabled) return;
  
  cache.set(hash, {
    result,
    timestamp: Date.now(),
    version: CACHE_VERSION
  });
  
  // Simple cache cleanup - keep only last 100 entries
  if (cache.size > 100) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
}

// Check if exclusion is standard IRDAI
function isStandardExclusion(text: string): boolean {
  const lower = text.toLowerCase();
  return CONFIG.standardIrdaiExclusions.some(exc => lower.includes(exc));
}

// Sanitize number within bounds
function sanitizeNumber(
  value: number | null | undefined,
  type: 'months' | 'days' | 'percentage' | 'hospitalCount' | 'amount'
): number | null {
  if (value === null || value === undefined || isNaN(value)) return null;
  
  const bounds = CONFIG.sanityBounds[type];
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return Math.round(value);
}

// Extract numbers from text using regex
function extractNumbersFromText(text: string): number[] {
  const patterns = [
    /(\d+)\s*months?/gi,
    /(\d+)\s*days?/gi,
    /(\d+)\s*years?/gi,
    /(\d+)\s*%/g,
    /(\d+(?:,\d{3})*(?:\.\d+)?)/g,
    /₹\s*(\d+(?:,\d{3})*)/g,
    /rs\.?\s*(\d+(?:,\d{3})*)/gi,
    /inr\s*(\d+(?:,\d{3})*)/gi
  ];
  
  const numbers: number[] = [];
  
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const numStr = match[1].replace(/,/g, '');
      const num = parseFloat(numStr);
      if (!isNaN(num)) {
        numbers.push(num);
      }
    }
  }
  
  return [...new Set(numbers)]; // Remove duplicates
}

// Validate quote exists in document
function validateQuoteInDocument(quote: string, document: string): boolean {
  if (!quote || quote.length < 10) return false;
  
  // Normalize both strings
  const normalizedQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedDoc = document.toLowerCase().replace(/\s+/g, ' ');
  
  // Direct inclusion
  if (normalizedDoc.includes(normalizedQuote)) return true;
  
  // Check for partial match (at least 70% of words present in sequence)
  const quoteWords = normalizedQuote.split(' ').filter(w => w.length > 3);
  if (quoteWords.length < 3) return true; // Too short to validate
  
  const requiredMatches = Math.ceil(quoteWords.length * 0.7);
  let consecutiveMatches = 0;
  let maxConsecutive = 0;
  
  for (const word of quoteWords) {
    if (normalizedDoc.includes(word)) {
      consecutiveMatches++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveMatches);
    } else {
      consecutiveMatches = 0;
    }
  }
  
  return maxConsecutive >= requiredMatches;
}

// Validate and correct numeric extraction
function validateNumericExtraction(
  llmValue: number | null,
  rawValue: string,
  quote: string,
  type: 'months' | 'days' | 'percentage'
): { value: number | null; method: "llm" | "regex" | "both" | "failed" } {
  
  // Extract numbers from rawValue and quote
  const textToSearch = `${rawValue} ${quote}`;
  const regexNumbers = extractNumbersFromText(textToSearch);
  
  // Special handling for years → months conversion
  const yearsMatch = textToSearch.match(/(\d+)\s*years?/i);
  if (yearsMatch && type === 'months') {
    const years = parseInt(yearsMatch[1]);
    regexNumbers.push(years * 12);
  }
  
  // If LLM value exists and matches a regex number, high confidence
  if (llmValue !== null) {
    const sanitizedLlm = sanitizeNumber(llmValue, type);
    
    if (sanitizedLlm !== null && regexNumbers.includes(sanitizedLlm)) {
      return { value: sanitizedLlm, method: "both" };
    }
    
    // LLM value exists but doesn't match regex - trust LLM but flag
    if (sanitizedLlm !== null) {
      return { value: sanitizedLlm, method: "llm" };
    }
  }
  
  // Try to find a reasonable number from regex
  if (regexNumbers.length > 0) {
    // For months, prefer numbers in typical waiting period range (12-60)
    if (type === 'months') {
      const typicalMonths = regexNumbers.find(n => n >= 12 && n <= 60);
      if (typicalMonths) return { value: typicalMonths, method: "regex" };
    }
    
    // For days, prefer numbers in typical range (0-365)
    if (type === 'days') {
      const typicalDays = regexNumbers.find(n => n >= 0 && n <= 365);
      if (typicalDays) return { value: typicalDays, method: "regex" };
    }
    
    // For percentage, prefer numbers 0-100
    if (type === 'percentage') {
      const typicalPct = regexNumbers.find(n => n >= 0 && n <= 100);
      if (typicalPct) return { value: typicalPct, method: "regex" };
    }
    
    // Fallback to first number in bounds
    const sanitized = sanitizeNumber(regexNumbers[0], type);
    if (sanitized !== null) {
      return { value: sanitized, method: "regex" };
    }
  }
  
  return { value: null, method: "failed" };
}

// Chunk document for processing
function chunkDocument(text: string): string[] {
  const { maxCharsPerChunk, overlapChars, maxChunks } = CONFIG.chunking;
  
  if (text.length <= maxCharsPerChunk) {
    return [text];
  }
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length && chunks.length < maxChunks) {
    let end = start + maxCharsPerChunk;
    
    // Try to break at a paragraph or sentence boundary
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('\n\n', end);
      if (breakPoint > start + maxCharsPerChunk * 0.7) {
        end = breakPoint;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > start + maxCharsPerChunk * 0.7) {
          end = sentenceBreak + 1;
        }
      }
    }
    
    chunks.push(text.substring(start, end));
    start = end - overlapChars; // Overlap for context continuity
  }
  
  return chunks;
}

// User-friendly error messages
function getUserFriendlyError(error: any): string {
  const message = error?.message || String(error);
  
  if (message.includes('429') || message.includes('rate limit')) {
    return 'Our service is experiencing high demand. Please wait a moment and try again.';
  }
  
  if (message.includes('400') || message.includes('invalid')) {
    return 'There was an issue processing your document. Please ensure it\'s a valid health insurance policy PDF.';
  }
  
  if (message.includes('401') || message.includes('403') || message.includes('authentication')) {
    return 'Service configuration error. Please contact support.';
  }
  
  if (message.includes('500') || message.includes('503')) {
    return 'Our analysis service is temporarily unavailable. Please try again in a few minutes.';
  }
  
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return 'The analysis is taking longer than expected. Please try with a smaller document or try again later.';
  }
  
  if (message.includes('safety') || message.includes('blocked')) {
    return 'The document could not be processed due to content restrictions. Please try a different document.';
  }
  
  if (message.includes('JSON') || message.includes('parse')) {
    return 'There was an error processing the analysis results. Please try again.';
  }
  
  return 'An unexpected error occurred. Please try again or contact support if the issue persists.';
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: CLASSIFICATION RULES (USING CONFIGURABLE THRESHOLDS)
// ═══════════════════════════════════════════════════════════════════════════

function classifyPedWaiting(months: number | null): { category: Category; rule: string } {
  if (months === null) {
    return { category: "UNCLEAR", rule: "PED waiting period not specified" };
  }
  
  const t = CONFIG.thresholds.pedWaiting;
  
  if (months <= t.great.maxMonths) {
    return { category: "GREAT", rule: `PED ${months} months (< ${t.great.maxMonths + 1} months)` };
  }
  
  if (months <= t.good.maxMonths) {
    return { category: "GOOD", rule: `PED ${months} months (${t.great.maxMonths + 1}-${t.good.maxMonths} months = standard)` };
  }
  
  return { category: "BAD", rule: `PED ${months} months (> ${t.good.maxMonths} months)` };
}

function classifySpecificIllnessWaiting(months: number | null): { category: Category; rule: string } {
  if (months === null) {
    return { category: "UNCLEAR", rule: "Specific illness waiting not specified" };
  }
  
  const t = CONFIG.thresholds.specificIllnessWaiting;
  
  if (months <= t.great.maxMonths) {
    return { category: "GREAT", rule: `Specific illness ${months} months (< ${t.great.maxMonths + 1} months)` };
  }
  
  if (months <= t.good.maxMonths) {
    return { category: "GOOD", rule: `Specific illness ${months} months (standard)` };
  }
  
  return { category: "BAD", rule: `Specific illness ${months} months (> ${t.good.maxMonths} months)` };
}

function classifyInitialWaiting(days: number | null): { category: Category; rule: string } {
  if (days === null) {
    return { category: "UNCLEAR", rule: "Initial waiting not specified" };
  }
  
  const t = CONFIG.thresholds.initialWaiting;
  
  if (days <= t.great.maxDays) {
    return { category: "GREAT", rule: "No initial waiting period" };
  }
  
  if (days <= t.good.maxDays) {
    return { category: "GOOD", rule: `Initial waiting ${days} days (standard)` };
  }
  
  return { category: "BAD", rule: `Initial waiting ${days} days (> ${t.good.maxDays} days)` };
}

function classifyPreHospitalization(days: number | null): { category: Category; rule: string } {
  if (days === null) {
    return { category: "UNCLEAR", rule: "Pre-hospitalization not specified" };
  }
  
  const t = CONFIG.thresholds.preHospitalization;
  
  if (days >= t.great.minDays) {
    return { category: "GREAT", rule: `Pre-hospitalization ${days} days (≥ ${t.great.minDays} days)` };
  }
  
  if (days >= t.good.minDays) {
    return { category: "GOOD", rule: `Pre-hospitalization ${days} days (standard)` };
  }
  
  return { category: "BAD", rule: `Pre-hospitalization ${days} days (< ${t.good.minDays} days)` };
}

function classifyPostHospitalization(days: number | null): { category: Category; rule: string } {
  if (days === null) {
    return { category: "UNCLEAR", rule: "Post-hospitalization not specified" };
  }
  
  const t = CONFIG.thresholds.postHospitalization;
  
  if (days >= t.great.minDays) {
    return { category: "GREAT", rule: `Post-hospitalization ${days} days (≥ ${t.great.minDays} days)` };
  }
  
  if (days >= t.good.minDays) {
    return { category: "GOOD", rule: `Post-hospitalization ${days} days (standard)` };
  }
  
  return { category: "BAD", rule: `Post-hospitalization ${days} days (< ${t.good.minDays} days)` };
}

function classifyRoomRent(feature: RoomRentFeature): { category: Category; rule: string } {
  if (!feature.found) {
    return { category: "UNCLEAR", rule: "Room rent terms not found" };
  }
  
  if (feature.hasProportionateDeduction) {
    return { category: "BAD", rule: "Proportionate deduction clause present - major red flag" };
  }
  
  if (feature.hasLimit && feature.limitAmount) {
    return { category: "BAD", rule: `Room rent capped at ₹${feature.limitAmount.toLocaleString()}/day` };
  }
  
  if (feature.limitType === 'percentage') {
    return { category: "BAD", rule: "Room rent capped as percentage of sum insured" };
  }
  
  const noLimitPattern = /no limit|any room|no cap|no sub-?limit|no capping|without.*limit/i;
  if (noLimitPattern.test(feature.rawValue)) {
    return { category: "GREAT", rule: "No room rent limit - any room allowed" };
  }
  
  const singleAcPattern = /single.*private.*ac|single.*ac|private.*ac.*room|single.*room/i;
  if (singleAcPattern.test(feature.rawValue)) {
    return { category: "GOOD", rule: "Single Private AC room allowed (standard)" };
  }
  
  return { category: "UNCLEAR", rule: "Room rent terms unclear - verify with insurer" };
}

function classifyCoPay(feature: CoPayFeature): { category: Category; rule: string } {
  if (!feature.found) {
    return { category: "UNCLEAR", rule: "Co-pay terms not found" };
  }
  
  // Optional co-pay (like Network Advantage) is always GOOD
  if (feature.isOptional) {
    const coverName = feature.optionalCoverName || "optional cover";
    return { 
      category: "GOOD", 
      rule: `Co-pay is optional via ${coverName} - customer choice for premium discount` 
    };
  }
  
  const t = CONFIG.thresholds.coPay;
  
  // No co-pay
  if (feature.percentage === null || feature.percentage === 0) {
    return { category: "GREAT", rule: "No co-payment required" };
  }
  
  // Zone-based mandatory co-pay is always BAD
  if (feature.isZoneBased) {
    return { category: "BAD", rule: "Zone-based mandatory co-pay penalizes metro hospitals" };
  }
  
  // Mandatory for all ages is BAD
  if (feature.appliesToAllAges && feature.percentage > 0) {
    return { 
      category: "BAD", 
      rule: `Mandatory ${feature.percentage}% co-pay for all ages` 
    };
  }
  
  // High percentage is BAD
  if (feature.percentage > t.good.maxPercentage) {
    return { category: "BAD", rule: `Co-pay ${feature.percentage}% exceeds acceptable limit` };
  }
  
  // Reasonable co-pay for seniors only is GOOD
  return { 
    category: "GOOD", 
    rule: `Co-pay ${feature.percentage}% applies to senior citizens only (standard)` 
  };
}

function classifyRestore(feature: RestoreFeature): { category: Category; rule: string } {
  if (!feature.found) {
    return { category: "UNCLEAR", rule: "Restore/recharge benefit not mentioned" };
  }
  
  if (!feature.available) {
    return { category: "BAD", rule: "No restore/recharge benefit available" };
  }
  
  if (feature.unlimited && feature.sameIllnessCovered) {
    return { category: "GREAT", rule: "Unlimited restore for any illness including same illness" };
  }
  
  if (feature.sameIllnessCovered) {
    return { category: "GREAT", rule: "Restore benefit covers same illness" };
  }
  
  if (feature.unlimited) {
    return { category: "GREAT", rule: "Unlimited restore benefit" };
  }
  
  return { category: "GOOD", rule: "Restore benefit for unrelated illness only" };
}

function classifyConsumables(feature: CoverageFeature): { category: Category; rule: string } {
  if (!feature.found) {
    return { category: "UNCLEAR", rule: "Consumables coverage not mentioned" };
  }
  
  if (!feature.covered) {
    return { category: "BAD", rule: "Consumables/non-medical items not covered" };
  }
  
  if (feature.fullyCovered) {
    return { category: "GREAT", rule: "Consumables fully covered without sub-limits" };
  }
  
  return { category: "GOOD", rule: "Consumables partially covered or with sub-limits" };
}

function classifyNetworkHospitals(count: number | null): { category: Category; rule: string } {
  if (count === null) {
    return { category: "UNCLEAR", rule: "Network hospital count not specified" };
  }
  
  const t = CONFIG.thresholds.networkHospitals;
  
  if (count >= t.great.minCount) {
    return { category: "GREAT", rule: `${count.toLocaleString()}+ cashless hospitals` };
  }
  
  if (count >= t.good.minCount) {
    return { category: "GOOD", rule: `${count.toLocaleString()} cashless hospitals (standard)` };
  }
  
  return { category: "BAD", rule: `Only ${count.toLocaleString()} cashless hospitals (limited network)` };
}

function classifyStandardCoverage(
  feature: CoverageFeature, 
  featureName: string,
  isRareFeature: boolean = false
): { category: Category; rule: string } {
  if (!feature.found) {
    // Rare features not found = just don't mention (not unclear)
    if (isRareFeature) {
      return { category: "UNCLEAR", rule: `${featureName} not mentioned` };
    }
    return { category: "UNCLEAR", rule: `${featureName} not mentioned` };
  }
  
  if (!feature.covered) {
    if (isRareFeature) {
      // Rare features not covered = don't flag as BAD
      return { category: "UNCLEAR", rule: `${featureName} not covered` };
    }
    return { category: "BAD", rule: `${featureName} not covered` };
  }
  
  if (feature.fullyCovered) {
    return { category: "GREAT", rule: `${featureName} fully covered` };
  }
  
  return { category: "GOOD", rule: `${featureName} covered` };
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: GEMINI API WITH RETRY AND ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

async function callGeminiWithRetry(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  schema: object,
  maxTokens: number = 8192
): Promise<any> {
  const { maxRetries, retryDelayMs, retryBackoffMultiplier } = CONFIG.api;
  
  let lastError: Error | null = null;
  let delay = retryDelayMs;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `${systemPrompt}\n\n---\n\n${userContent}` }]
            }],
            generationConfig: {
              temperature: 0.1,
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
        
        // Don't retry on 400 (bad request) or 401/403 (auth errors)
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw new Error(`API error ${response.status}: ${errorText}`);
        }
        
        // Retry on 429 (rate limit) and 5xx errors
        throw new Error(`Retryable API error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      // Check for safety blocks
      if (data.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new Error('Content blocked by safety filters');
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) {
        throw new Error('Empty response from API');
      }

      return JSON.parse(text);
      
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on non-retryable errors
      if (error.message?.includes('400') || 
          error.message?.includes('401') || 
          error.message?.includes('403') ||
          error.message?.includes('safety filters')) {
        throw error;
      }
      
      // Log retry attempt
      console.log(`API attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delay}ms...`);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= retryBackoffMultiplier;
      }
    }
  }
  
  throw lastError || new Error('API call failed after retries');
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: SCHEMAS FOR GEMINI
// ═══════════════════════════════════════════════════════════════════════════

const validationSchema = {
  type: "object",
  properties: {
    isHealthInsurance: { type: "boolean" },
    documentType: { 
      type: "string", 
      enum: ["Health Insurance Policy", "Health Insurance Brochure", "Policy Schedule", "Not Health Insurance", "Other Insurance"] 
    },
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
        policyType: { type: "string", enum: ["Individual", "Family Floater", "Group", "Not specified"] },
        documentType: { type: "string", enum: ["Policy Wording", "Brochure", "Policy Schedule", "Mixed"] }
      },
      required: ["name", "insurer", "sumInsured", "policyType", "documentType"]
    },
    features: {
      type: "object",
      properties: {
        roomRent: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            quote: { type: "string" },
            reference: { type: "string" },
            hasLimit: { type: "boolean" },
            limitAmount: { type: "number", nullable: true },
            limitType: { type: "string", enum: ["daily_cap", "percentage", "none"] },
            hasProportionateDeduction: { type: "boolean" }
          },
          required: ["found", "rawValue", "quote", "reference", "hasLimit", "limitType", "hasProportionateDeduction"]
        },
        pedWaiting: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            months: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        specificIllnessWaiting: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            months: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        initialWaiting: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            days: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        coPay: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            percentage: { type: "number", nullable: true },
            isOptional: { type: "boolean" },
            optionalCoverName: { type: "string", nullable: true },
            appliesToAllAges: { type: "boolean" },
            isZoneBased: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "isOptional", "appliesToAllAges", "isZoneBased", "quote", "reference"]
        },
        restore: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            available: { type: "boolean" },
            sameIllnessCovered: { type: "boolean" },
            unlimited: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "available", "sameIllnessCovered", "unlimited", "quote", "reference"]
        },
        preHospitalization: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            days: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        postHospitalization: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            days: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        consumables: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        daycare: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        ambulance: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            limit: { type: "number", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        ayush: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        domiciliary: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        organDonor: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        airAmbulance: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            limit: { type: "number", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        networkHospitals: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            count: { type: "integer", nullable: true },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "quote", "reference"]
        },
        modernTreatments: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            rawValue: { type: "string" },
            covered: { type: "boolean" },
            fullyCovered: { type: "boolean" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "rawValue", "covered", "fullyCovered", "quote", "reference"]
        },
        diseaseSubLimits: {
          type: "object",
          properties: {
            found: { type: "boolean" },
            hasSubLimits: { type: "boolean" },
            details: { type: "string" },
            quote: { type: "string" },
            reference: { type: "string" }
          },
          required: ["found", "hasSubLimits", "details", "quote", "reference"]
        }
      },
      required: ["roomRent", "pedWaiting", "specificIllnessWaiting", "initialWaiting", "coPay", "restore", "preHospitalization", "postHospitalization", "consumables"]
    },
    uniqueFeatures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          rawValue: { type: "string" },
          quote: { type: "string" },
          reference: { type: "string" }
        },
        required: ["name", "rawValue", "quote", "reference"]
      }
    },
    nonStandardExclusions: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: ["policyInfo", "features", "uniqueFeatures", "nonStandardExclusions"]
};

const uniqueFeatureJudgmentSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["GREAT", "GOOD", "BAD"] },
    reasoning: { type: "string" }
  },
  required: ["category", "reasoning"]
};

const explanationSchema = {
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
// SECTION 7: PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const validationPrompt = `Determine if this is a health insurance policy document from India.

HEALTH INSURANCE documents contain terms like:
- Hospitalization, In-patient treatment, Day care
- Sum Insured, Coverage, Benefits
- Cashless, Network hospitals, TPA
- Pre-existing disease, Waiting period
- Room rent, ICU charges
- IRDAI

NOT health insurance:
- Life insurance, Motor insurance, Travel insurance, Home insurance
- Bank statements, Invoices, Resumes
- Insurance from outside India`;

const extractionPrompt = `You are a health insurance feature extraction assistant. 

TASK: Extract ALL features from this policy document with their EXACT values.

CRITICAL RULES:
1. DO NOT categorize features - just extract raw values
2. Extract EXACT QUOTES from the document (copy-paste)
3. For numeric values, extract the actual number
4. For waiting periods in years, convert to months (e.g., 3 years = 36 months)
5. If something is not found, set found: false
6. Be precise with boolean flags (isOptional, appliesToAllAges, etc.)

SPECIAL ATTENTION:

Room Rent:
- Look for: daily caps, percentage limits, proportionate deduction clauses
- "Single Private AC Room" vs "Any Room" vs "₹X,000/day limit"

Co-Pay:
- Check if it's OPTIONAL (e.g., "Network Advantage" discount) or MANDATORY
- If it's part of an optional cover that gives premium discount → isOptional: true
- Note if it applies to all ages or only seniors (60+)

Restore/Recharge/Reset Benefit:
- Does it work for SAME illness or only UNRELATED illness?
- Is it unlimited or limited times?

Unique Features:
- Look for features that seem innovative or rare:
  - Automatic sum insured increase (like "2x Cover")
  - Premium cashback / Wellness rewards
  - OPD coverage in base plan
  - Chronic care from Day 1
  - Any feature that sounds unique

Non-Standard Exclusions:
- Only list exclusions that are NOT standard IRDAI exclusions
- Standard (ignore): maternity, infertility, cosmetic, obesity, war, self-harm, hazardous sports, alcoholism, dental, spectacles, HIV, vitamins, rest cure, LASIK, gender change`;

const uniqueFeaturePrompt = `Evaluate this health insurance feature:

Feature Name: "{name}"
Description: "{rawValue}"  
Quote from policy: "{quote}"

Is this feature:
- GREAT: Rare in market, significantly benefits customer, innovative
- GOOD: Useful but fairly common
- BAD: Has hidden drawbacks despite sounding positive

Respond with category and brief reasoning.`;

const explanationPrompt = `Write simple, customer-friendly explanations for each feature.

RULES:
1. Use plain English, avoid jargon
2. Keep explanations to 1-2 sentences
3. For BAD features, explain the risk/impact clearly
4. For GREAT features, explain why it's valuable
5. Don't be promotional - be factual

The category has already been decided. Just explain what each feature means for the customer.`;

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: MERGE EXTRACTIONS FROM MULTIPLE CHUNKS
// ═══════════════════════════════════════════════════════════════════════════

function mergeExtractions(extractions: any[]): any {
  if (extractions.length === 0) {
    throw new Error('No extractions to merge');
  }
  
  if (extractions.length === 1) {
    return extractions[0];
  }
  
  // Start with first extraction as base
  const merged = JSON.parse(JSON.stringify(extractions[0]));
  
  // Merge policy info - prefer non-empty values
  for (const ext of extractions.slice(1)) {
    if (ext.policyInfo) {
      for (const key of Object.keys(ext.policyInfo)) {
        const currentValue = merged.policyInfo?.[key];
        const newValue = ext.policyInfo[key];
        
        if ((!currentValue || currentValue === 'Not specified') && newValue && newValue !== 'Not specified') {
          merged.policyInfo[key] = newValue;
        }
      }
    }
  }
  
  // Merge features - prefer found: true and more complete data
  for (const ext of extractions.slice(1)) {
    if (ext.features) {
      for (const key of Object.keys(ext.features)) {
        const currentFeature = merged.features?.[key];
        const newFeature = ext.features[key];
        
        if (!currentFeature?.found && newFeature?.found) {
          merged.features[key] = newFeature;
        } else if (currentFeature?.found && newFeature?.found) {
          // Both found - prefer the one with more data
          const currentQuoteLen = currentFeature.quote?.length || 0;
          const newQuoteLen = newFeature.quote?.length || 0;
          
          if (newQuoteLen > currentQuoteLen) {
            merged.features[key] = newFeature;
          }
        }
      }
    }
  }
  
  // Merge unique features - deduplicate by name
  const uniqueFeatureNames = new Set<string>();
  const mergedUniqueFeatures: any[] = [];
  
  for (const ext of extractions) {
    for (const uf of ext.uniqueFeatures || []) {
      const normalizedName = uf.name.toLowerCase().trim();
      if (!uniqueFeatureNames.has(normalizedName)) {
        uniqueFeatureNames.add(normalizedName);
        mergedUniqueFeatures.push(uf);
      }
    }
  }
  merged.uniqueFeatures = mergedUniqueFeatures;
  
  // Merge non-standard exclusions - deduplicate
  const allExclusions = new Set<string>();
  for (const ext of extractions) {
    for (const exc of ext.nonStandardExclusions || []) {
      allExclusions.add(exc.toLowerCase().trim());
    }
  }
  merged.nonStandardExclusions = [...allExclusions];
  
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 9: MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const logs: string[] = [];
  const log = (msg: string) => {
    const timestamp = Date.now() - startTime;
    logs.push(`[${timestamp}ms] ${msg}`);
    console.log(`[${timestamp}ms] ${msg}`);
  };

  try {
    // Validate content length before processing
    const MAX_REQUEST_SIZE = 25 * 1024 * 1024; // 25MB
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
      console.warn(`Request too large: ${contentLength} bytes`);
      return new Response(
        JSON.stringify({ error: 'Request payload too large. Maximum file size is 20MB.' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { policyText } = await req.json();

    if (!policyText || policyText.trim().length < 500) {
      return new Response(
        JSON.stringify({ 
          error: 'Document too short or empty. Please upload a complete health insurance policy document.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    log(`Document received: ${policyText.length} characters`);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 0: CHECK CACHE
    // ═══════════════════════════════════════════════════════════════════════
    
    const documentHash = await hashDocument(policyText);
    log(`Document hash: ${documentHash.substring(0, 16)}...`);
    
    const cachedResult = getCachedResult(documentHash);
    if (cachedResult) {
      log('Cache HIT - returning cached result');
      return new Response(
        JSON.stringify({
          ...cachedResult,
          _meta: {
            ...cachedResult._meta,
            cached: true,
            cacheHit: true
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    log('Cache MISS - proceeding with analysis');

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('API configuration error');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: VALIDATION
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 1: Validating document...');
    
    const validation = await callGeminiWithRetry(
      geminiApiKey,
      validationPrompt,
      policyText.substring(0, 4000),
      validationSchema,
      500
    );

    log(`Validation: ${validation.isHealthInsurance ? 'Valid' : 'Invalid'} - ${validation.documentType}`);

    if (!validation.isHealthInsurance) {
      return new Response(
        JSON.stringify({
          error: 'invalid_document',
          message: `This doesn't appear to be a health insurance policy document. Detected: ${validation.documentType}. ${validation.reason}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: FEATURE EXTRACTION (with chunking for long documents)
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 2: Extracting features...');
    
    const chunks = chunkDocument(policyText);
    log(`Document split into ${chunks.length} chunk(s)`);
    
    let extraction: any = null;
    
    if (chunks.length === 1) {
      // Single chunk - simple extraction
      extraction = await callGeminiWithRetry(
        geminiApiKey,
        extractionPrompt,
        chunks[0],
        extractionSchema,
        8192
      );
    } else {
      // Multiple chunks - extract from each and merge
      log('Processing multiple chunks...');
      
      const chunkExtractions = [];
      for (let i = 0; i < chunks.length; i++) {
        log(`Processing chunk ${i + 1}/${chunks.length}...`);
        const chunkExtraction = await callGeminiWithRetry(
          geminiApiKey,
          extractionPrompt + `\n\nNote: This is part ${i + 1} of ${chunks.length} of the document.`,
          chunks[i],
          extractionSchema,
          8192
        );
        chunkExtractions.push(chunkExtraction);
      }
      
      // Merge extractions
      extraction = mergeExtractions(chunkExtractions);
      log('Chunks merged');
    }

    log(`Extraction complete: ${extraction.uniqueFeatures?.length || 0} unique features found`);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: VALIDATE EXTRACTIONS AND APPLY CLASSIFICATION RULES
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 3: Validating extractions and classifying...');

    const classifiedFeatures: ClassifiedFeature[] = [];
    const f = extraction.features;

    // Helper to add classified feature with quote validation
    const addFeature = (
      name: string,
      category: Category,
      value: string,
      quote: string,
      reference: string,
      rule: string
    ) => {
      const quoteValidated = validateQuoteInDocument(quote, policyText);
      if (!quoteValidated) {
        log(`WARNING: Quote not validated for ${name}`);
      }
      
      classifiedFeatures.push({
        name,
        category,
        value,
        quote,
        reference,
        classifiedBy: "code",
        ruleApplied: rule,
        quoteValidated
      });
    };

    // Room Rent
    if (f.roomRent?.found) {
      const result = classifyRoomRent(f.roomRent);
      addFeature(
        "Room Rent",
        result.category,
        f.roomRent.rawValue,
        f.roomRent.quote,
        f.roomRent.reference,
        result.rule
      );
    }

    // PED Waiting - with numeric validation
    if (f.pedWaiting?.found) {
      const validated = validateNumericExtraction(
        f.pedWaiting.months,
        f.pedWaiting.rawValue,
        f.pedWaiting.quote,
        'months'
      );
      log(`PED: LLM=${f.pedWaiting.months}, Validated=${validated.value}, Method=${validated.method}`);
      
      const result = classifyPedWaiting(validated.value);
      addFeature(
        "Pre-Existing Disease Waiting Period",
        result.category,
        f.pedWaiting.rawValue,
        f.pedWaiting.quote,
        f.pedWaiting.reference,
        result.rule
      );
    }

    // Specific Illness Waiting - with numeric validation
    if (f.specificIllnessWaiting?.found) {
      const validated = validateNumericExtraction(
        f.specificIllnessWaiting.months,
        f.specificIllnessWaiting.rawValue,
        f.specificIllnessWaiting.quote,
        'months'
      );
      
      const result = classifySpecificIllnessWaiting(validated.value);
      addFeature(
        "Specific Illness Waiting Period",
        result.category,
        f.specificIllnessWaiting.rawValue,
        f.specificIllnessWaiting.quote,
        f.specificIllnessWaiting.reference,
        result.rule
      );
    }

    // Initial Waiting - with numeric validation
    if (f.initialWaiting?.found) {
      const validated = validateNumericExtraction(
        f.initialWaiting.days,
        f.initialWaiting.rawValue,
        f.initialWaiting.quote,
        'days'
      );
      
      const result = classifyInitialWaiting(validated.value);
      addFeature(
        "Initial Waiting Period",
        result.category,
        f.initialWaiting.rawValue,
        f.initialWaiting.quote,
        f.initialWaiting.reference,
        result.rule
      );
    }

    // Co-Pay - with numeric validation
    if (f.coPay?.found) {
      const validated = validateNumericExtraction(
        f.coPay.percentage,
        f.coPay.rawValue,
        f.coPay.quote,
        'percentage'
      );
      
      const coPayFeature: CoPayFeature = {
        ...f.coPay,
        percentage: validated.value,
        extractedNumber: f.coPay.percentage,
        validatedNumber: validated.value,
        validationMethod: validated.method,
        confidence: validated.method === 'both' ? 'high' : validated.method === 'failed' ? 'low' : 'medium'
      };
      
      const result = classifyCoPay(coPayFeature);
      addFeature(
        "Co-Payment",
        result.category,
        f.coPay.rawValue,
        f.coPay.quote,
        f.coPay.reference,
        result.rule
      );
    }

    // Restore Benefit
    if (f.restore?.found) {
      const restoreFeature: RestoreFeature = {
        ...f.restore,
        percentageRestore: null,
        confidence: 'medium'
      };
      const result = classifyRestore(restoreFeature);
      addFeature(
        "Restore/Recharge Benefit",
        result.category,
        f.restore.rawValue,
        f.restore.quote,
        f.restore.reference,
        result.rule
      );
    }

    // Pre-Hospitalization
    if (f.preHospitalization?.found) {
      const validated = validateNumericExtraction(
        f.preHospitalization.days,
        f.preHospitalization.rawValue,
        f.preHospitalization.quote,
        'days'
      );
      
      const result = classifyPreHospitalization(validated.value);
      addFeature(
        "Pre-Hospitalization Coverage",
        result.category,
        f.preHospitalization.rawValue,
        f.preHospitalization.quote,
        f.preHospitalization.reference,
        result.rule
      );
    }

    // Post-Hospitalization
    if (f.postHospitalization?.found) {
      const validated = validateNumericExtraction(
        f.postHospitalization.days,
        f.postHospitalization.rawValue,
        f.postHospitalization.quote,
        'days'
      );
      
      const result = classifyPostHospitalization(validated.value);
      addFeature(
        "Post-Hospitalization Coverage",
        result.category,
        f.postHospitalization.rawValue,
        f.postHospitalization.quote,
        f.postHospitalization.reference,
        result.rule
      );
    }

    // Consumables
    if (f.consumables?.found) {
      const consumablesFeature: CoverageFeature = {
        ...f.consumables,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyConsumables(consumablesFeature);
      addFeature(
        "Consumables Coverage",
        result.category,
        f.consumables.rawValue,
        f.consumables.quote,
        f.consumables.reference,
        result.rule
      );
    }

    // Day Care
    if (f.daycare?.found) {
      const daycareFeature: CoverageFeature = {
        ...f.daycare,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(daycareFeature, "Day Care Procedures");
      addFeature(
        "Day Care Procedures",
        result.category,
        f.daycare.rawValue,
        f.daycare.quote,
        f.daycare.reference,
        result.rule
      );
    }

    // Ambulance
    if (f.ambulance?.found) {
      const ambulanceFeature: CoverageFeature = {
        ...f.ambulance,
        hasSubLimit: f.ambulance.limit !== null,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(ambulanceFeature, "Ambulance");
      addFeature(
        "Ambulance Coverage",
        result.category,
        f.ambulance.rawValue,
        f.ambulance.quote,
        f.ambulance.reference,
        result.rule
      );
    }

    // AYUSH
    if (f.ayush?.found) {
      const ayushFeature: CoverageFeature = {
        ...f.ayush,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(ayushFeature, "AYUSH Treatment");
      addFeature(
        "AYUSH Treatment",
        result.category,
        f.ayush.rawValue,
        f.ayush.quote,
        f.ayush.reference,
        result.rule
      );
    }

    // Domiciliary
    if (f.domiciliary?.found) {
      const domiciliaryFeature: CoverageFeature = {
        ...f.domiciliary,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(domiciliaryFeature, "Domiciliary Hospitalization", true);
      addFeature(
        "Domiciliary Hospitalization",
        result.category,
        f.domiciliary.rawValue,
        f.domiciliary.quote,
        f.domiciliary.reference,
        result.rule
      );
    }

    // Organ Donor
    if (f.organDonor?.found) {
      const organDonorFeature: CoverageFeature = {
        ...f.organDonor,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(organDonorFeature, "Organ Donor Expenses", true);
      addFeature(
        "Organ Donor Expenses",
        result.category,
        f.organDonor.rawValue,
        f.organDonor.quote,
        f.organDonor.reference,
        result.rule
      );
    }

    // Air Ambulance
    if (f.airAmbulance?.found) {
      const airAmbulanceFeature: CoverageFeature = {
        ...f.airAmbulance,
        hasSubLimit: f.airAmbulance.limit !== null,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(airAmbulanceFeature, "Air Ambulance", true);
      addFeature(
        "Air Ambulance",
        result.category,
        f.airAmbulance.rawValue,
        f.airAmbulance.quote,
        f.airAmbulance.reference,
        result.rule
      );
    }

    // Network Hospitals
    if (f.networkHospitals?.found) {
      const count = sanitizeNumber(f.networkHospitals.count, 'hospitalCount');
      const result = classifyNetworkHospitals(count);
      addFeature(
        "Network Hospitals",
        result.category,
        f.networkHospitals.rawValue,
        f.networkHospitals.quote,
        f.networkHospitals.reference,
        result.rule
      );
    }

    // Modern Treatments
    if (f.modernTreatments?.found) {
      const modernTreatmentsFeature: CoverageFeature = {
        ...f.modernTreatments,
        limit: null,
        hasSubLimit: false,
        confidence: 'medium'
      };
      const result = classifyStandardCoverage(modernTreatmentsFeature, "Modern Treatments");
      addFeature(
        "Modern Treatments",
        result.category,
        f.modernTreatments.rawValue,
        f.modernTreatments.quote,
        f.modernTreatments.reference,
        result.rule
      );
    }

    // Disease Sub-Limits
    if (f.diseaseSubLimits?.found && f.diseaseSubLimits.hasSubLimits) {
      addFeature(
        "Disease-wise Sub-Limits",
        "BAD",
        f.diseaseSubLimits.details,
        f.diseaseSubLimits.quote,
        f.diseaseSubLimits.reference,
        "Disease-specific sub-limits reduce effective coverage"
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: PROCESS UNIQUE FEATURES (LLM judgment needed)
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 4: Processing unique features...');
    
    for (const uf of extraction.uniqueFeatures || []) {
      try {
        const prompt = uniqueFeaturePrompt
          .replace('{name}', uf.name)
          .replace('{rawValue}', uf.rawValue)
          .replace('{quote}', uf.quote);
        
        const judgment = await callGeminiWithRetry(
          geminiApiKey,
          prompt,
          '',
          uniqueFeatureJudgmentSchema,
          200
        );
        
        const quoteValidated = validateQuoteInDocument(uf.quote, policyText);
        
        classifiedFeatures.push({
          name: uf.name,
          category: judgment.category as Category,
          value: uf.rawValue,
          quote: uf.quote,
          reference: uf.reference,
          explanation: judgment.reasoning,
          classifiedBy: "llm",
          ruleApplied: `LLM judgment: ${judgment.reasoning}`,
          quoteValidated
        });
      } catch (error) {
        log(`Failed to judge unique feature ${uf.name}: ${error}`);
        // Default to GOOD if judgment fails
        classifiedFeatures.push({
          name: uf.name,
          category: "GOOD",
          value: uf.rawValue,
          quote: uf.quote,
          reference: uf.reference,
          classifiedBy: "code",
          ruleApplied: "Default to GOOD (LLM judgment failed)",
          quoteValidated: validateQuoteInDocument(uf.quote, policyText)
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: PROCESS NON-STANDARD EXCLUSIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 5: Processing non-standard exclusions...');
    
    for (const exclusion of extraction.nonStandardExclusions || []) {
      // Double-check it's not a standard exclusion
      if (!isStandardExclusion(exclusion)) {
        classifiedFeatures.push({
          name: `Exclusion: ${exclusion}`,
          category: "BAD",
          value: exclusion,
          quote: "",
          reference: "Exclusions section",
          classifiedBy: "code",
          ruleApplied: "Non-standard exclusion beyond IRDAI list",
          quoteValidated: false
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: GENERATE EXPLANATIONS
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 6: Generating explanations...');
    
    // Only generate explanations for features that don't have them
    const needExplanation = classifiedFeatures.filter(f => !f.explanation);
    
    if (needExplanation.length > 0) {
      try {
        const featuresForExplanation = needExplanation.map(f => ({
          name: f.name,
          category: f.category,
          value: f.value,
          rule: f.ruleApplied
        }));
        
        const explanations = await callGeminiWithRetry(
          geminiApiKey,
          explanationPrompt,
          JSON.stringify(featuresForExplanation),
          explanationSchema,
          4096
        );
        
        // Map explanations back to features
        for (const exp of explanations) {
          const feature = classifiedFeatures.find(f => f.name === exp.name);
          if (feature) {
            feature.explanation = exp.explanation;
          }
        }
      } catch (error) {
        log(`Failed to generate explanations: ${error}`);
        // Generate simple fallback explanations
        for (const feature of needExplanation) {
          if (!feature.explanation) {
            feature.explanation = feature.ruleApplied;
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: BUILD FINAL RESPONSE
    // ═══════════════════════════════════════════════════════════════════════
    
    log('Step 7: Building response...');

    // Separate by category
    const great = classifiedFeatures.filter(f => f.category === "GREAT");
    const good = classifiedFeatures.filter(f => f.category === "GOOD");
    const bad = classifiedFeatures.filter(f => f.category === "BAD");
    const unclear = classifiedFeatures.filter(f => f.category === "UNCLEAR");

    // Build response in expected format
    const response = {
      policyName: extraction.policyInfo?.name || validation.insurerName || 'Health Insurance Policy',
      insurer: extraction.policyInfo?.insurer || validation.insurerName || 'Not specified',
      sumInsured: extraction.policyInfo?.sumInsured || 'Not specified',
      policyType: extraction.policyInfo?.policyType || 'Not specified',
      documentType: extraction.policyInfo?.documentType || validation.documentType,
      summary: {
        great: great.length,
        good: good.length,
        bad: bad.length,
        unclear: unclear.length
      },
      features: {
        great: great.map(f => ({
          name: f.name,
          quote: f.quote,
          reference: f.reference,
          explanation: f.explanation || f.ruleApplied
        })),
        good: good.map(f => ({
          name: f.name,
          quote: f.quote,
          reference: f.reference,
          explanation: f.explanation || f.ruleApplied
        })),
        bad: bad.map(f => ({
          name: f.name,
          quote: f.quote,
          reference: f.reference,
          explanation: f.explanation || f.ruleApplied
        })),
        unclear: unclear.map(f => ({
          name: f.name,
          quote: f.quote,
          reference: f.reference,
          explanation: f.explanation || f.ruleApplied
        }))
      },
      disclaimer: "Standard IRDAI exclusions apply. This analysis is for informational purposes only. Please verify all details with your insurer or policy document before making decisions.",
      _meta: {
        processingTimeMs: Date.now() - startTime,
        documentLength: policyText.length,
        chunksProcessed: chunks.length,
        featuresAnalyzed: classifiedFeatures.length,
        cacheHit: false,
        version: CACHE_VERSION
      }
    };

    // Cache the result
    setCachedResult(documentHash, response);
    
    log(`Analysis complete in ${Date.now() - startTime}ms`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Analysis error:', error);
    
    const userMessage = getUserFriendlyError(error);
    
    return new Response(
      JSON.stringify({ 
        error: userMessage,
        _debug: {
          message: error.message,
          processingTimeMs: Date.now() - startTime
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
