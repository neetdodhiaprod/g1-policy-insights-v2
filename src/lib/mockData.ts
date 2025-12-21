export interface PolicyFeature {
  name: string;
  quote: string;
  reference: string;
  explanation: string;
}

export interface PolicyAnalysis {
  policyName: string;
  insurer: string;
  sumInsured: string;
  policyType: string;
  documentType: string;
  summary: {
    great: number;
    good: number;
    bad: number;
    unclear: number;
  };
  features: {
    great: PolicyFeature[];
    good: PolicyFeature[];
    bad: PolicyFeature[];
    unclear: PolicyFeature[];
  };
  disclaimer: string;
}

export const mockAnalysisData: PolicyAnalysis = {
  policyName: "Max Bupa Health Companion",
  insurer: "Max Bupa Health Insurance",
  sumInsured: "₹10,00,000",
  policyType: "Individual",
  documentType: "Policy Wording",
  disclaimer: "This analysis is for informational purposes only. Please read the full policy document and consult with the insurer for complete details.",
  summary: {
    great: 5,
    good: 4,
    bad: 2,
    unclear: 3,
  },
  features: {
    great: [
      {
        name: "No Room Rent Limit",
        quote: "Room Rent: At Actuals",
        reference: "Page 16, Section 4.2",
        explanation:
          "You can choose any room in any hospital and the full cost will be covered. No daily cap or proportionate deduction. This is excellent as room rent limits often lead to significant out-of-pocket expenses.",
      },
      {
        name: "No Disease-wise Sub-limits",
        quote: "All covered diseases shall be payable up to Sum Insured without any sub-limits",
        reference: "Page 18, Section 5.1",
        explanation:
          "There are no caps on specific diseases like heart surgery or cancer treatment. Your full sum insured is available for any covered illness.",
      },
      {
        name: "Restoration Benefit",
        quote: "100% restoration of Sum Insured once during the policy period for unrelated illness",
        reference: "Page 22, Section 7.3",
        explanation:
          "If you exhaust your sum insured on one claim, you get the full amount restored for any subsequent unrelated illness. This provides crucial additional coverage.",
      },
      {
        name: "Day Care Procedures Covered",
        quote: "All Day Care Procedures as per IRDAI list and beyond are covered",
        reference: "Page 14, Section 3.5",
        explanation:
          "Modern treatments that don't require 24-hour hospitalization are fully covered. This includes procedures like dialysis, chemotherapy, and cataract surgery.",
      },
      {
        name: "No Claim Bonus",
        quote: "Cumulative Bonus of 10% per claim-free year, up to maximum 50% of Sum Insured",
        reference: "Page 24, Section 8.1",
        explanation:
          "Your coverage increases by 10% for each year you don't claim, up to 50% extra. This rewards healthy years with better protection.",
      },
    ],
    good: [
      {
        name: "Pre-existing Disease Coverage",
        quote: "Pre-existing diseases covered after 3 years of continuous coverage",
        reference: "Page 20, Section 6.1",
        explanation:
          "Standard 3-year waiting period for pre-existing conditions. While not the shortest in the market, this is reasonable and transparent.",
      },
      {
        name: "Maternity Coverage",
        quote: "Maternity expenses up to ₹50,000 for normal delivery and ₹75,000 for C-section after 2 years waiting period",
        reference: "Page 26, Section 9.2",
        explanation:
          "Maternity is covered but with a 2-year waiting period and sub-limits. The limits are adequate for most hospitals but may not cover premium facilities entirely.",
      },
      {
        name: "Annual Health Check-up",
        quote: "Annual health check-up benefit up to 1% of Sum Insured",
        reference: "Page 28, Section 10.1",
        explanation:
          "Free annual health check-up is included. While the 1% limit is modest, it encourages preventive care.",
      },
      {
        name: "Ambulance Coverage",
        quote: "Ambulance charges up to ₹3,000 per hospitalization",
        reference: "Page 15, Section 3.8",
        explanation:
          "Ambulance expenses are covered with a reasonable limit. This covers most emergency transport situations.",
      },
    ],
    bad: [
      {
        name: "Co-payment Clause",
        quote: "20% co-payment applicable for all claims if insured age is above 60 years",
        reference: "Page 12, Section 2.4",
        explanation:
          "If you're over 60, you'll have to pay 20% of every claim from your pocket. This can be significant for large medical bills and should be factored into your decision.",
      },
      {
        name: "Specific Disease Waiting Period",
        quote: "24 months waiting period for specified diseases including hernia, cataract, joint replacement",
        reference: "Page 21, Section 6.3",
        explanation:
          "Common procedures like cataract surgery and joint replacement have a 2-year waiting period. If you anticipate needing these, consider the timing carefully.",
      },
    ],
    unclear: [
      {
        name: "AYUSH Treatment Coverage",
        quote: "AYUSH treatments covered as per terms and conditions",
        reference: "Page 30, Section 11.2",
        explanation:
          "The policy mentions AYUSH coverage but doesn't clearly specify limits, covered treatments, or network hospitals. Clarify this with the insurer if you use alternative medicine.",
      },
      {
        name: "Home Healthcare",
        quote: "Domiciliary treatment covered under certain circumstances",
        reference: "Page 19, Section 5.4",
        explanation:
          "Home treatment coverage terms are vague. The 'certain circumstances' need clarification to understand when you'd actually be covered for treatment at home.",
      },
      {
        name: "Mental Health Coverage",
        quote: "Mental illness treated as per applicable regulations",
        reference: "Page 17, Section 4.5",
        explanation:
          "While mental health must be covered by regulation, the policy doesn't specify treatment types, limits, or conditions clearly. Get this clarified in writing.",
      },
    ],
  },
};
