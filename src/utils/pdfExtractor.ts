import * as pdfjsLib from 'pdfjs-dist';

// Set worker source using Vite-compatible import.meta.url approach
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export type PDFExtractionError = 'PASSWORD_PROTECTED' | 'SCANNED_PDF' | 'CORRUPTED' | 'UNKNOWN';

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
        'This PDF appears to be scanned or image-based. Please upload a text-based PDF where you can select and copy text.'
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
