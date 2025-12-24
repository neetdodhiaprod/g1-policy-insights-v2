import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VERSION = "6.0.0";

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

// Known feature configurations for code-based classification
const FEATURES: Record<string, { name: string; lowerBetter?: boolean; great?: number; redFlag?: number; greatTerms?: string[]; redFlagTerms?: string[] }> = {
  pedWaiting: { name: "Pre-Existing Disease Waiting", lowerBetter: true, great: 24, redFlag: 48 },
  specificIllnessWaiting: { name: "Specific Illness Waiting", lowerBetter: true, great: 12, redFlag: 24 },
  initialWaiting: { name: "Initial Waiting Period", lowerBetter: true, great: 0, redFlag: 30 },
  preHospitalization: { name: "Pre-Hospitalization", lowerBetter: false, great: 60, redFlag: 30 },
  postHospitalization: { name: "Post-Hospitalization", lowerBetter: false, great: 180, redFlag: 60 },
  roomRent: { name: "Room Rent", greatTerms: ["no limit", "no cap", "any room"], redFlagTerms: ["proportionate", "capped", "daily limit"] },
  coPay: { name: "Co-payment", greatTerms: ["no co-pay", "nil", "0%"], redFlagTerms: ["mandatory", "all claims"] },
  restore: { name: "Restore Benefit", greatTerms: ["unlimited", "100%", "same illness"], redFlagTerms: ["not available", "no restore"] },
  consumables: { name: "Consumables", greatTerms: ["fully covered", "no sub-limit"], redFlagTerms: ["not covered", "excluded"] },
  daycare: { name: "Day Care Procedures", lowerBetter: false, great: 500, redFlag: 100 },
  networkHospitals: { name: "Network Hospitals", lowerBetter: false, great: 10000, redFlag: 3000 },
  ncb: { name: "No Claim Bonus", lowerBetter: false, great: 50, redFlag: 10 },
  modernTreatments: { name: "Modern Treatments", greatTerms: ["fully covered"], redFlagTerms: ["not covered", "excluded"] },
  ayush: { name: "AYUSH Treatment", greatTerms: ["covered", "included"], redFlagTerms: ["not covered", "excluded"] },
};

type Category = "GREAT" | "GOOD" | "RED_FLAG" | "UNCLEAR";

function classifyFeature(id: string, value: string, numVal?: number): Category {
  const config = FEATURES[id];
  if (!config) return "GOOD";
  
  const lower = value.toLowerCase();
  
  // Rule-based
  if (config.redFlagTerms?.some(t => lower.includes(t))) return "RED_FLAG";
  if (config.greatTerms?.some(t => lower.includes(t))) return "GREAT";
  
  // Threshold-based
  if (numVal !== undefined && config.great !== undefined && config.redFlag !== undefined) {
    if (config.lowerBetter) {
      if (numVal <= config.great) return "GREAT";
      if (numVal >= config.redFlag) return "RED_FLAG";
    } else {
      if (numVal >= config.great) return "GREAT";
      if (numVal <= config.redFlag) return "RED_FLAG";
    }
  }
  
  return "GOOD";
}

// Extract features using simple regex patterns (no AI needed for basic extraction)
function extractFeaturesFromText(text: string): Array<{id: string; value: string; num?: number}> {
  const features: Array<{id: string; value: string; num?: number}> = [];
  const lower = text.toLowerCase();
  
  // Pre-existing disease waiting period
  const pedMatch = lower.match(/pre[- ]?existing[^.]*?(\d+)\s*(month|year)/i);
  if (pedMatch) {
    const months = pedMatch[2].includes('year') ? parseInt(pedMatch[1]) * 12 : parseInt(pedMatch[1]);
    features.push({ id: 'pedWaiting', value: `${months} months`, num: months });
  }
  
  // Initial waiting period
  const initMatch = lower.match(/initial[^.]*?waiting[^.]*?(\d+)\s*day/i);
  if (initMatch) {
    features.push({ id: 'initialWaiting', value: `${initMatch[1]} days`, num: parseInt(initMatch[1]) });
  }
  
  // Pre-hospitalization
  const preHospMatch = lower.match(/pre[- ]?hospitali[sz]ation[^.]*?(\d+)\s*day/i);
  if (preHospMatch) {
    features.push({ id: 'preHospitalization', value: `${preHospMatch[1]} days`, num: parseInt(preHospMatch[1]) });
  }
  
  // Post-hospitalization
  const postHospMatch = lower.match(/post[- ]?hospitali[sz]ation[^.]*?(\d+)\s*day/i);
  if (postHospMatch) {
    features.push({ id: 'postHospitalization', value: `${postHospMatch[1]} days`, num: parseInt(postHospMatch[1]) });
  }
  
  // Room rent
  if (lower.includes('room') && lower.includes('rent')) {
    if (lower.includes('no limit') || lower.includes('no cap') || lower.includes('no restriction')) {
      features.push({ id: 'roomRent', value: 'No limit' });
    } else if (lower.includes('single private') || lower.includes('single ac')) {
      features.push({ id: 'roomRent', value: 'Single Private Room' });
    } else if (lower.includes('proportionate')) {
      features.push({ id: 'roomRent', value: 'Proportionate deduction' });
    }
  }
  
  // Co-payment
  if (lower.includes('co-pay') || lower.includes('copay') || lower.includes('co pay')) {
    if (lower.includes('no co-pay') || lower.includes('nil') || /co-?pay[^.]*?0\s*%/i.test(lower)) {
      features.push({ id: 'coPay', value: 'No co-payment' });
    } else if (lower.includes('mandatory')) {
      features.push({ id: 'coPay', value: 'Mandatory co-payment' });
    } else {
      const coPayMatch = lower.match(/co-?pay[^.]*?(\d+)\s*%/i);
      if (coPayMatch) {
        features.push({ id: 'coPay', value: `${coPayMatch[1]}% co-payment` });
      }
    }
  }
  
  // Restore/Recharge
  if (lower.includes('restore') || lower.includes('recharge')) {
    if (lower.includes('unlimited') || lower.includes('100%')) {
      features.push({ id: 'restore', value: 'Unlimited restore' });
    } else if (lower.includes('same illness')) {
      features.push({ id: 'restore', value: 'Available for same illness' });
    } else if (lower.includes('different illness')) {
      features.push({ id: 'restore', value: 'Different illness only' });
    }
  }
  
  // Consumables
  if (lower.includes('consumable')) {
    if (lower.includes('covered') || lower.includes('payable')) {
      features.push({ id: 'consumables', value: 'Covered' });
    } else if (lower.includes('not covered') || lower.includes('excluded')) {
      features.push({ id: 'consumables', value: 'Not covered' });
    }
  }
  
  // Day care procedures
  const daycareMatch = lower.match(/(\d+)\s*(?:day\s*care|daycare)\s*procedure/i) || 
                       lower.match(/day\s*care[^.]*?(\d+)\s*procedure/i);
  if (daycareMatch) {
    features.push({ id: 'daycare', value: `${daycareMatch[1]} procedures`, num: parseInt(daycareMatch[1]) });
  }
  
  // Network hospitals
  const networkMatch = lower.match(/(\d+,?\d*)\s*(?:network|cashless)\s*hospital/i) ||
                       lower.match(/network[^.]*?(\d+,?\d*)\s*hospital/i);
  if (networkMatch) {
    const count = parseInt(networkMatch[1].replace(',', ''));
    features.push({ id: 'networkHospitals', value: `${count} hospitals`, num: count });
  }
  
  // No claim bonus
  const ncbMatch = lower.match(/no\s*claim\s*bonus[^.]*?(\d+)\s*%/i);
  if (ncbMatch) {
    features.push({ id: 'ncb', value: `${ncbMatch[1]}% per year`, num: parseInt(ncbMatch[1]) });
  }
  
  // Modern treatments
  if (lower.includes('modern treatment') || lower.includes('advanced treatment')) {
    if (lower.includes('covered') || lower.includes('payable')) {
      features.push({ id: 'modernTreatments', value: 'Covered' });
    } else if (lower.includes('not covered') || lower.includes('excluded')) {
      features.push({ id: 'modernTreatments', value: 'Not covered' });
    }
  }
  
  // AYUSH
  if (lower.includes('ayush')) {
    if (lower.includes('covered') || lower.includes('payable')) {
      features.push({ id: 'ayush', value: 'Covered' });
    } else if (lower.includes('not covered') || lower.includes('excluded')) {
      features.push({ id: 'ayush', value: 'Not covered' });
    }
  }
  
  return features;
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

    // Validate
    const validation = validateDocument(policyText);
    if (!validation.valid) {
      log("VALIDATE", `Failed: ${validation.error}`, startTime);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    log("VALIDATE", "Passed", startTime);

    // Extract features using regex (no AI call - faster and reliable)
    log("EXTRACT", "Starting regex extraction", startTime);
    const rawFeatures = extractFeaturesFromText(policyText);
    log("EXTRACT", `Found ${rawFeatures.length} features`, startTime);

    // Classify features
    const allFeatures = rawFeatures.map(f => {
      const category = classifyFeature(f.id, f.value, f.num);
      const config = FEATURES[f.id];
      return {
        name: config?.name || f.id,
        policyStates: f.value,
        reference: "",
        explanation: `${config?.name || f.id}: ${f.value}`,
        category
      };
    });

    // Group by category
    const great = allFeatures.filter(f => f.category === "GREAT");
    const good = allFeatures.filter(f => f.category === "GOOD");
    const redFlags = allFeatures.filter(f => f.category === "RED_FLAG");
    const unclear = allFeatures.filter(f => f.category === "UNCLEAR");

    const format = (f: any) => ({
      name: f.name,
      policyStates: f.policyStates,
      reference: f.reference,
      explanation: f.explanation
    });

    const result = {
      policyName: "Health Insurance Policy",
      insurer: "See document",
      sumInsured: "See policy schedule",
      policyType: "Health Insurance",
      summary: {
        great: great.length,
        good: good.length,
        redFlags: redFlags.length,
        unclear: unclear.length
      },
      greatFeatures: great.map(format),
      goodFeatures: good.map(format),
      redFlags: redFlags.map(format),
      needsClarification: unclear.map(format),
      disclaimer: "This analysis is based on keyword extraction. Please verify all details with your insurer.",
      _meta: {
        version: VERSION,
        processingTimeMs: Date.now() - startTime,
        features: allFeatures.length
      }
    };

    log("DONE", `${Date.now() - startTime}ms, ${allFeatures.length} features`, startTime);

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
