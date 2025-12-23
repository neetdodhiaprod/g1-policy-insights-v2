import { useState, useCallback } from "react";
import { Upload, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface UploadSectionProps {
  onAnalyze: (file: File) => void;
  isLoading: boolean;
}

const UploadSection = ({ onAnalyze, isLoading }: UploadSectionProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();

  const validateFileSize = (file: File): boolean => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Maximum file size is ${MAX_FILE_SIZE_MB}MB. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`,
      });
      return false;
    }
    return true;
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type === "application/pdf") {
        if (validateFileSize(file)) {
          setSelectedFile(file);
        }
      } else {
        toast({
          variant: "destructive",
          title: "Invalid file type",
          description: "Please upload a PDF file.",
        });
      }
    }
  }, [toast]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (validateFileSize(file)) {
        setSelectedFile(file);
      }
    }
  }, [toast]);

  const handleRemoveFile = () => {
    setSelectedFile(null);
  };

  const handleAnalyze = () => {
    if (selectedFile) {
      onAnalyze(selectedFile);
    }
  };

  return (
    <div className="bg-card rounded-2xl shadow-card p-8 md:p-10">
      <div
        className={`upload-zone ${dragActive ? 'dragging' : ''} p-8 md:p-12 text-center cursor-pointer relative`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !selectedFile && document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={handleFileInput}
        />

        {selectedFile ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <div className="flex items-center gap-3">
              <span className="font-body font-medium text-foreground">
                {selectedFile.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile();
                }}
                className="w-6 h-6 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
            <span className="font-body text-sm text-muted-foreground">
              {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
            </span>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <p className="font-body font-medium text-foreground mb-2">
              Drop your policy PDF here or click to browse
            </p>
            <p className="font-body text-sm text-muted-foreground">
              Supports PDF files up to 20MB
            </p>
          </>
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <Button
          onClick={handleAnalyze}
          disabled={!selectedFile || isLoading}
          size="lg"
          className="font-body font-semibold px-8"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <div className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Analyzing...
            </span>
          ) : (
            "Analyze Policy"
          )}
        </Button>
      </div>
    </div>
  );
};

export default UploadSection;
