import * as pdfjsLib from 'pdfjs-dist';

// Set worker source using Vite-compatible import.meta.url approach
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export type PDFExtractionError = 'PASSWORD_PROTECTED' | 'SCANNED_PDF' | 'CORRUPTED' | 'NOT_A_POLICY' | 'UNKNOWN';

// Keywords that indicate an insurance policy document
const POLICY_KEYWORDS = {
  // General insurance terms
  general: [
    'insurance', 'policy', 'coverage', 'premium', 'insured', 'beneficiary',
    'claim', 'deductible', 'exclusion', 'sum insured', 'policyholder',
    'indemnity', 'underwriter', 'endorsement', 'waiting period', 'co-pay',
    'policy schedule', 'terms and conditions', 'policy document', 'insurer',
    'risk cover', 'policy period', 'renewal', 'lapse', 'grace period'
  ],
  // Health insurance specific
  health: [
    'health insurance', 'mediclaim', 'hospitalization', 'pre-existing disease',
    'cashless', 'network hospital', 'room rent', 'icu', 'daycare procedure',
    'sub-limit', 'no claim bonus', 'restoration benefit', 'maternity',
    'critical illness', 'health cover', 'medical expenses', 'ambulance',
    'domiciliary', 'ayush', 'opd', 'pre-hospitalization', 'post-hospitalization'
  ],
  // Life insurance specific
  life: [
    'life insurance', 'term plan', 'term life', 'whole life', 'endowment',
    'maturity benefit', 'death benefit', 'survival benefit', 'nominee',
    'life assured', 'life cover', 'mortality', 'ulip', 'surrender value',
    'paid-up value', 'revival', 'rider', 'accidental death', 'terminal illness'
  ],
  // Auto/Motor insurance specific
  auto: [
    'motor insurance', 'vehicle insurance', 'car insurance', 'auto insurance',
    'third party', 'own damage', 'comprehensive cover', 'idv', 'insured vehicle',
    'ncb', 'zero depreciation', 'roadside assistance', 'engine protect',
    'personal accident', 'passenger cover', 'theft', 'total loss', 'bumper to bumper'
  ],
  // Home insurance specific
  home: [
    'home insurance', 'property insurance', 'house insurance', 'dwelling',
    'building insurance', 'contents insurance', 'fire insurance', 'burglary',
    'natural calamity', 'earthquake', 'flood damage', 'structure cover',
    'household goods', 'valuable items', 'liability cover', 'tenant', 'landlord'
  ]
};

function isPolicyDocument(text: string): boolean {
  const lowerText = text.toLowerCase();
  let totalMatches = 0;
  let categoryMatches: Record<string, number> = {};
  
  // Check all categories
  for (const [category, keywords] of Object.entries(POLICY_KEYWORDS)) {
    categoryMatches[category] = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        totalMatches++;
        categoryMatches[category]++;
      }
    }
  }
  
  // Must have at least 3 general insurance terms
  const hasGeneralTerms = categoryMatches['general'] >= 3;
  
  // Must have at least 2 matches from any specific insurance type
  const hasSpecificType = 
    categoryMatches['health'] >= 2 ||
    categoryMatches['life'] >= 2 ||
    categoryMatches['auto'] >= 2 ||
    categoryMatches['home'] >= 2;
  
  // Require both general terms AND specific type keywords
  return hasGeneralTerms && hasSpecificType;
}

export class PDFError extends Error {
  type: PDFExtractionError;
  
  constructor(type: PDFExtractionError, message: string) {
    super(message);
    this.type = type;
    this.name = 'PDFError';
  }
}

export async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    } catch (error: any) {
      // Check for password protected PDF
      if (error?.name === 'PasswordException' || error?.message?.includes('password')) {
        throw new PDFError(
          'PASSWORD_PROTECTED',
          'This PDF is password protected. Please upload an unlocked version.'
        );
      }
      // Check for corrupted PDF
      if (error?.name === 'InvalidPDFException' || error?.message?.includes('Invalid')) {
        throw new PDFError(
          'CORRUPTED',
          "We couldn't read this file. Please try uploading again."
        );
      }
      throw new PDFError(
        'UNKNOWN',
        "We couldn't read this file. Please try uploading again."
      );
    }
    
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n\n';
    }
    
    // Check if PDF is scanned/image-based (very little text extracted)
    if (fullText.trim().length < 100) {
      throw new PDFError(
        'SCANNED_PDF',
        'This PDF appears to be scanned or image-based and we cannot extract text from it. Please upload your health insurance "Policy Wording" or "Terms & Conditions" document - this is usually a separate PDF from your insurance company that contains all the coverage details, exclusions, and waiting periods. If you only have a scanned copy, please request a digital version from your insurer.'
      );
    }
    
    // Check if the document is actually an insurance policy
    if (!isPolicyDocument(fullText)) {
      throw new PDFError(
        'NOT_A_POLICY',
        'This doesn\'t appear to be an insurance policy document. Please upload a valid insurance policy PDF.'
      );
    }
    
    return fullText.trim();
  } catch (error) {
    if (error instanceof PDFError) {
      throw error;
    }
    throw new PDFError(
      'CORRUPTED',
      "We couldn't read this file. Please try uploading again."
    );
  }
}
