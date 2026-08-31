import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useListDocuments, 
  useUploadDocument,
  useRequestUploadUrl,
  getGetStatsQueryKey,
  getListDocumentsQueryKey
} from "@workspace/api-client-react";
import { 
  FileText, 
  UploadCloud, 
  File, 
  X,
  Search,
  Calendar,
  Store,
  ArrowUpRight,
  Database,
  AlertCircle
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

function MetricBadge({ label, value, color, bg, border }: { label: string, value: string | number, color?: string, bg?: string, border?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-md border-2", bg || "bg-card", border || "border-foreground/20")}>
      <span className="text-[10px] font-mono font-bold uppercase text-muted-foreground">{label}:</span>
      <span className={cn("font-mono text-xs font-bold uppercase tracking-wider", color || "text-foreground")}>{value}</span>
    </div>
  );
}

export default function Documents() {
  const [searchTerm, setSearchTerm] = useState("");
  const { data: documents, isLoading } = useListDocuments({
    query: {
      queryKey: getListDocumentsQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.some((document) => document.processingStatus === "Processing")
          ? 2_000
          : false,
    },
  });
  
  const filteredDocs = documents?.filter(d => 
    d.franchiseName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    d.filename.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b-4 border-foreground pb-8">
        <div>
          <h1 className="text-5xl md:text-7xl font-display font-black tracking-tighter text-foreground uppercase leading-[0.9] mb-4">
            Source<br/><span className="text-primary">Documents</span>
          </h1>
          <p className="text-lg font-medium text-foreground/80 font-sans max-w-xl">
            Manage your uploaded Franchise Disclosure Documents and track extraction progress.
          </p>
        </div>
        <UploadDialog />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground stroke-[3]" />
          <Input 
            placeholder="Search by franchise or filename..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-14 pl-12 border-2 border-foreground rounded-xl bg-card text-lg font-medium brutal-shadow-sm focus-visible:ring-0 focus-visible:border-primary transition-all"
            data-testid="input-doc-search"
          />
        </div>
        <div className="brutal-card rounded-xl px-6 py-2 flex items-center justify-center bg-accent font-mono font-bold uppercase tracking-widest text-sm">
          {filteredDocs.length} Docs
        </div>
      </div>

      {/* List */}
      <div className="space-y-6">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="brutal-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center gap-6">
              <Skeleton className="w-16 h-16 rounded-xl border-2 border-foreground bg-foreground/10 shrink-0" />
              <div className="space-y-3 flex-1">
                <Skeleton className="h-8 w-64 bg-foreground/10" />
                <Skeleton className="h-4 w-48 bg-foreground/10" />
              </div>
              <Skeleton className="h-12 w-32 rounded-xl bg-foreground/10" />
            </div>
          ))
        ) : filteredDocs.length > 0 ? (
          filteredDocs.map((doc) => {
            const isSuccess = ["Completed", "Ready", "Needs review"].includes(doc.processingStatus);
            const isFailed = doc.processingStatus === "Failed";
            
            return (
              <div key={doc.id} className="group brutal-card rounded-2xl p-0 overflow-hidden flex flex-col hover:bg-card/80 transition-colors" data-testid={`doc-row-${doc.id}`}>
                <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-start gap-6">
                    <div className="w-16 h-16 bg-primary text-primary-foreground border-2 border-foreground rounded-xl flex items-center justify-center shrink-0 brutal-shadow-sm group-hover:rotate-6 transition-transform">
                      <Database className="w-8 h-8 stroke-[2.5]" />
                    </div>
                    
                    <div>
                      <h3 className="text-2xl font-display font-black uppercase tracking-tight flex flex-wrap items-center gap-3">
                        {doc.franchiseName}
                        {doc.fddYear && (
                          <span className="font-mono text-xs bg-foreground text-background px-2.5 py-1 rounded uppercase tracking-widest">
                            {doc.fddYear}
                          </span>
                        )}
                      </h3>
                      
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 font-mono text-sm font-bold text-muted-foreground mt-3 uppercase tracking-wider">
                        <span className="flex items-center gap-2 text-foreground/80">
                          <File className="w-4 h-4" />
                          <span className="max-w-[200px] truncate normal-case">{doc.filename}</span>
                        </span>
                        <span className="flex items-center gap-2 text-foreground/80">
                          <Calendar className="w-4 h-4" />
                          {format(parseISO(doc.uploadDate), "MMM d, yyyy")}
                        </span>
                        {doc.locationCount > 0 && (
                          <span className="flex items-center gap-2 text-foreground bg-accent px-3 py-1 rounded-md border-2 border-foreground brutal-shadow-sm">
                            <Store className="w-4 h-4" />
                            {doc.locationCount} LOC
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-col md:items-end gap-4 border-t-2 md:border-t-0 border-foreground/10 pt-4 md:pt-0">
                    <div className="flex flex-col items-start md:items-end gap-1.5">
                      <div className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">Pipeline Status</div>
                      <div className={cn(
                        "px-4 py-1.5 border-2 border-foreground font-bold text-sm uppercase tracking-wider rounded-full brutal-shadow-sm",
                        doc.processingStatus === "Needs review" ? "bg-amber-300" :
                        isSuccess ? "bg-emerald-300" : 
                        isFailed ? "bg-rose-400" : "bg-accent animate-pulse"
                      )}>
                        {doc.processingStatus}
                      </div>
                      {doc.stages && doc.stages.length > 0 && !isSuccess && (
                        <div className="text-xs font-mono font-bold text-foreground/60 max-w-[200px] truncate text-right uppercase tracking-wider mt-1">
                          → {doc.stages[doc.stages.length - 1].stage}
                        </div>
                      )}
                    </div>
                    
                    <Link href={`/locations?documentId=${doc.id}`} data-testid={`link-doc-locations-${doc.id}`}>
                      <Button className="brutal-btn rounded-lg bg-foreground text-background hover:bg-foreground/90 gap-2 w-full md:w-auto">
                        Locations <ArrowUpRight className="w-4 h-4 stroke-[3]" />
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Metrics / Provenance Footer */}
                {(doc.extractionManifest || Object.keys(doc.recordCounts || {}).length > 0) && (
                  <div className="bg-foreground/5 border-t-2 border-foreground/10 p-6 flex flex-col gap-4">
                    {doc.extractionManifest && (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="text-[10px] font-display font-black uppercase tracking-widest text-muted-foreground mr-2 bg-foreground/10 px-2 py-1 rounded">Extraction Manifest</div>
                        
                        <MetricBadge label="Discovery" value={doc.extractionManifest.discoveryMethod} />
                        
                        {doc.extractionManifest.sourceRanges && doc.extractionManifest.sourceRanges.length > 0 && (
                          <MetricBadge label="Source Ranges" value={doc.extractionManifest.sourceRanges.map(r => `${r.pdfStart}-${r.pdfEnd}`).join(', ')} />
                        )}

                        <MetricBadge label="Pages Examined" value={doc.extractionManifest.pagesExamined?.length || 0} />
                        
                        <MetricBadge label="Accepted" value={doc.extractionManifest.acceptedRows} color="text-emerald-700" bg="bg-emerald-100" border="border-emerald-200" />

                        {doc.extractionManifest.addedRows !== undefined && (
                          <>
                            <MetricBadge label="New" value={doc.extractionManifest.addedRows} color="text-emerald-700" bg="bg-emerald-100" border="border-emerald-200" />
                            <MetricBadge label="Matched" value={doc.extractionManifest.matchedRows ?? 0} color="text-blue-700" bg="bg-blue-100" border="border-blue-200" />
                            <MetricBadge label="Updated" value={doc.extractionManifest.updatedRows ?? 0} color="text-violet-700" bg="bg-violet-100" border="border-violet-200" />
                            <MetricBadge label="Unchanged" value={doc.extractionManifest.unchangedRows ?? 0} />
                          </>
                        )}

                        {(doc.extractionManifest.ambiguousRows ?? 0) > 0 && (
                          <MetricBadge label="Needs Match Review" value={doc.extractionManifest.ambiguousRows ?? 0} color="text-amber-800" bg="bg-amber-100" border="border-amber-300" />
                        )}

                        {(doc.extractionManifest.collapsedRows ?? 0) > 0 && (
                          <MetricBadge label="Consolidated" value={doc.extractionManifest.collapsedRows ?? 0} color="text-blue-700" bg="bg-blue-100" border="border-blue-200" />
                        )}

                        {(doc.extractionManifest.removedRows ?? 0) > 0 && (
                          <MetricBadge label="Stale Removed" value={doc.extractionManifest.removedRows ?? 0} color="text-blue-700" bg="bg-blue-100" border="border-blue-200" />
                        )}
                        
                        {(doc.extractionManifest.rejectedRows > 0 || doc.extractionManifest.duplicateRows > 0) && (
                          <MetricBadge label="Dropped" value={`${doc.extractionManifest.rejectedRows + doc.extractionManifest.duplicateRows} (Rej: ${doc.extractionManifest.rejectedRows}, Dup: ${doc.extractionManifest.duplicateRows})`} color="text-rose-700" bg="bg-rose-100" border="border-rose-200" />
                        )}

                        {(doc.extractionManifest.missingAddressRows > 0 || doc.extractionManifest.missingContactRows > 0) && (
                          <MetricBadge label="Missing Data" value={`Addr: ${doc.extractionManifest.missingAddressRows}, Cont: ${doc.extractionManifest.missingContactRows}`} color="text-amber-700" bg="bg-amber-100" border="border-amber-200" />
                        )}
                      </div>
                    )}

                    {doc.extractionManifest?.warnings && doc.extractionManifest.warnings.length > 0 && (
                      <div className="bg-amber-100 border-2 border-amber-300 text-amber-900 rounded-lg p-3 text-sm font-mono font-medium flex gap-3 items-start brutal-shadow-sm mt-2">
                        <AlertCircle className="w-5 h-5 shrink-0 stroke-[2.5]" />
                        <div className="flex flex-col gap-1">
                          <span className="font-bold uppercase tracking-wide text-[10px]">Warnings</span>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {doc.extractionManifest.warnings.map((w, i) => <li key={i}>{w}</li>)}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="brutal-card rounded-2xl py-24 text-center flex flex-col items-center bg-card/50 border-dashed border-4 border-muted-foreground/30 shadow-none">
            <div className="w-20 h-20 bg-background border-2 border-foreground rounded-2xl flex items-center justify-center mb-6 brutal-shadow-sm -rotate-6">
              <Search className="w-10 h-10 text-muted-foreground stroke-[3]" />
            </div>
            <h3 className="text-3xl font-display font-black uppercase tracking-tight">No Documents Found</h3>
            <p className="mt-2 text-lg font-medium text-muted-foreground max-w-sm">
              {searchTerm ? "Try adjusting your search terms." : "You haven't uploaded any documents yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploadingToS3, setIsUploadingToS3] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestUrl = useRequestUploadUrl();
  const upload = useUploadDocument();
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === "application/pdf") {
        setFile(droppedFile);
      } else {
        toast({
          title: "Invalid file type",
          description: "Please upload a PDF document.",
          variant: "destructive"
        });
      }
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    try {
      // 1. Get presigned URL
      const dest = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type
        }
      });

      // 2. Upload file directly to S3
      setIsUploadingToS3(true);
      const s3Res = await fetch(dest.uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type
        }
      });
      
      if (!s3Res.ok) {
        throw new Error("Failed to upload to object storage");
      }
      setIsUploadingToS3(false);

      // 3. Notify backend
      upload.mutate(
        { data: { filename: file.name, objectPath: dest.objectPath } },
        {
          onSuccess: () => {
            toast({
              title: "UPLOAD INITIATED",
              description: `${file.name} is entering the pipeline.`,
            });
            queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
            setOpen(false);
            setFile(null);
          },
          onError: (error: any) => {
            toast({
              title: "Upload failed",
              description: error?.response?.data?.error || error.message || "An unexpected error occurred",
              variant: "destructive"
            });
          }
        }
      );
    } catch (err: any) {
      setIsUploadingToS3(false);
      toast({
        title: "Upload failed",
        description: err.message || "An unexpected error occurred",
        variant: "destructive"
      });
    }
  };

  const isPending = requestUrl.isPending || isUploadingToS3 || upload.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="brutal-btn rounded-xl text-base px-8 py-6 gap-3 group bg-primary text-primary-foreground" data-testid="button-open-upload">
          <UploadCloud className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
          Upload FDD
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] brutal-card rounded-2xl border-4 p-8">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-3xl font-display font-black uppercase tracking-tight">Upload FDD</DialogTitle>
          <p className="text-muted-foreground font-medium text-base">
            Drop a PDF to extract location data instantly.
          </p>
        </DialogHeader>
        
        {!file ? (
          <div 
            className={cn(
              "border-4 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all cursor-pointer text-center",
              isDragging ? "border-primary bg-primary/10 scale-[1.02]" : "border-foreground/30 hover:border-foreground hover:bg-muted/50"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="application/pdf"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />
            <div className="w-16 h-16 bg-background border-2 border-foreground brutal-shadow rounded-xl flex items-center justify-center mb-6">
              <UploadCloud className="w-8 h-8 text-foreground" />
            </div>
            <h4 className="text-xl font-display font-black uppercase tracking-tight mb-2">Click or Drag PDF</h4>
            <p className="font-mono text-sm font-bold text-muted-foreground uppercase tracking-widest">Max Size 50MB</p>
          </div>
        ) : (
          <div className="border-2 border-foreground brutal-shadow-sm rounded-xl p-5 flex items-center justify-between bg-card">
            <div className="flex items-center gap-4 overflow-hidden">
              <div className="w-12 h-12 bg-primary text-primary-foreground border-2 border-foreground rounded-lg flex items-center justify-center shrink-0">
                <FileText className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div className="overflow-hidden">
                <p className="font-bold text-base truncate">{file.name}</p>
                <p className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-widest mt-1">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {!isPending && (
              <Button variant="ghost" size="icon" onClick={() => setFile(null)} className="shrink-0 text-foreground hover:bg-destructive hover:text-destructive-foreground border-2 border-transparent hover:border-foreground rounded-lg transition-colors">
                <X className="w-5 h-5 stroke-[3]" />
              </Button>
            )}
          </div>
        )}

        {isPending && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between font-mono text-sm font-bold uppercase tracking-widest">
              <span>{isUploadingToS3 ? "Uploading to secure storage..." : "Initializing extraction pipeline..."}</span>
            </div>
            <Progress value={isUploadingToS3 ? 45 : 85} className="h-4 border-2 border-foreground rounded-full bg-background [&>div]:bg-primary" />
          </div>
        )}

        <div className="mt-8 flex flex-col-reverse sm:flex-row justify-end gap-4">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending} className="brutal-btn bg-background text-foreground hover:bg-muted sm:w-auto w-full">
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!file || isPending} className="brutal-btn bg-foreground text-background hover:bg-foreground/90 sm:w-auto w-full text-base px-8" data-testid="button-upload-submit">
            {isPending ? "Processing..." : "Run Pipeline"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
