import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetLocation, 
  useUpdateLocation,
  getGetLocationQueryKey,
  getListLocationsQueryKey,
  getGetStatsQueryKey
} from "@workspace/api-client-react";
import { 
  Building2, 
  MapPin, 
  User, 
  Phone, 
  Mail, 
  FileText,
  Save,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  PenLine,
  ArrowUpRight,
  AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function LocationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: location, isLoading } = useGetLocation(id);
  const updateLocation = useUpdateLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  const mutateFnRef = useRef(updateLocation.mutate);
  mutateFnRef.current = updateLocation.mutate;

  useEffect(() => {
    if (location) {
      setFormData({
        franchisor: location.franchisor || location.franchiseName || "",
        franchiseeEntity: location.franchiseeEntity || "",
        address: location.address || "",
        city: location.city || "",
        state: location.state || "",
        zip: location.zip || "",
        phone: location.phone || "",
        email: location.email || "",
        exitReason: location.exitReason || ""
      });
    }
  }, [location]);

  const handleSave = () => {
    mutateFnRef.current(
      { locationId: id, data: formData },
      {
        onSuccess: (data) => {
          toast({ title: "UPDATE SECURED", description: "Location details rewritten." });
          queryClient.setQueryData(getGetLocationQueryKey(id), data);
          queryClient.invalidateQueries({ queryKey: getListLocationsQueryKey() });
          setIsEditing(false);
        },
        onError: () => {
          toast({ title: "ERROR", description: "Mutation failed.", variant: "destructive" });
        }
      }
    );
  };

  const handleStatusChange = (status: "Approved" | "Rejected" | "Needs review") => {
    mutateFnRef.current(
      { locationId: id, data: { reviewStatus: status } },
      {
        onSuccess: (data) => {
          toast({ title: `STATUS: ${status.toUpperCase()}`, description: "Review registered." });
          queryClient.setQueryData(getGetLocationQueryKey(id), data);
          queryClient.invalidateQueries({ queryKey: getListLocationsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col h-full bg-background p-8 space-y-8">
        <Skeleton className="h-16 w-3/4 rounded-xl border-2 border-foreground" />
        <div className="grid grid-cols-2 gap-8">
          <Skeleton className="h-64 w-full rounded-2xl border-2 border-foreground" />
          <Skeleton className="h-64 w-full rounded-2xl border-2 border-foreground" />
        </div>
      </div>
    );
  }

  if (!location) {
    return <div className="flex-1 flex items-center justify-center font-display font-black text-2xl uppercase">Location missing in action</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full max-h-screen overflow-hidden bg-background relative z-10">
      
      {/* Top Header Panel */}
      <div className="border-b-4 border-foreground bg-card px-6 py-4 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-20 brutal-shadow-sm">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="brutal-btn h-10 w-10 rounded-lg p-0"
            aria-label="Close location details"
            data-testid="button-close-location-detail"
          >
            <ChevronLeft className="w-6 h-6 stroke-[3]" />
          </Button>
          <div className="flex gap-3">
            <div className="px-3 py-1 bg-foreground text-background font-mono text-sm font-bold uppercase tracking-widest rounded-md border-2 border-foreground">
              {location.status}
            </div>
            <div className={cn(
              "px-3 py-1 font-mono text-sm font-bold uppercase tracking-widest rounded-md border-2 border-foreground brutal-shadow-sm",
              location.reviewStatus === "Approved" ? "bg-emerald-400" :
              location.reviewStatus === "Rejected" ? "bg-rose-400" : "bg-accent"
            )}>
              {location.reviewStatus}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {location.reviewStatus !== "Approved" && (
            <Button 
              className="brutal-btn rounded-lg bg-emerald-400 hover:bg-emerald-500 gap-2 h-10"
              onClick={() => handleStatusChange("Approved")}
              disabled={updateLocation.isPending}
              data-testid="btn-approve"
            >
              <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
              Approve
            </Button>
          )}
          {location.reviewStatus !== "Rejected" && (
            <Button 
              className="brutal-btn rounded-lg bg-rose-400 hover:bg-rose-500 gap-2 h-10"
              onClick={() => handleStatusChange("Rejected")}
              disabled={updateLocation.isPending}
              data-testid="btn-reject"
            >
              <XCircle className="w-5 h-5 stroke-[2.5]" />
              Reject
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1 w-full bg-noise">
        <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-10">
          
          {/* Identity Block */}
          <div className="flex flex-col gap-6 border-b-4 border-foreground pb-8">
            <div className="flex flex-col md:flex-row justify-between items-start gap-6">
              <div className="max-w-2xl">
                <h2 className="text-4xl md:text-5xl font-display font-black uppercase tracking-tight leading-[0.95] mb-4">
                  {location.franchiseeEntity || "Unnamed Entity"}
                </h2>
                <div className="flex items-center gap-3 inline-flex px-4 py-2 bg-secondary border-2 border-foreground brutal-shadow-sm rounded-lg">
                  <Building2 className="w-5 h-5 stroke-[2.5]" />
                  <span className="font-mono text-sm font-bold uppercase tracking-widest">
                    Brand: {location.franchisor || location.franchiseName}
                  </span>
                </div>
              </div>
              
              {!isEditing ? (
                <Button onClick={() => setIsEditing(true)} className="brutal-btn bg-background text-foreground hover:bg-accent gap-2 shrink-0">
                  <PenLine className="w-4 h-4 stroke-[2.5]" />
                  Edit Record
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-3 shrink-0 bg-card p-2 rounded-xl border-2 border-foreground brutal-shadow-sm">
                  <Button variant="ghost" onClick={() => {
                    setIsEditing(false);
                    setFormData({
                      franchisor: location.franchisor || location.franchiseName || "",
                      franchiseeEntity: location.franchiseeEntity || "",
                      address: location.address || "",
                      city: location.city || "",
                      state: location.state || "",
                      zip: location.zip || "",
                      phone: location.phone || "",
                      email: location.email || "",
                      exitReason: location.exitReason || ""
                    });
                  }} className="font-mono font-bold uppercase tracking-wider text-xs">Cancel</Button>
                  <Button onClick={handleSave} className="brutal-btn bg-primary text-primary-foreground gap-2" disabled={updateLocation.isPending}>
                    <Save className="w-4 h-4 stroke-[2.5]" />
                    Save Edits
                  </Button>
                </div>
              )}
            </div>

            {location.reviewStatus === "Needs review" && location.reviewReason && (
              <div className="bg-rose-100 border-2 border-rose-500 text-rose-900 rounded-xl p-4 flex gap-4 items-start brutal-shadow-sm">
                <AlertTriangle className="w-6 h-6 shrink-0 stroke-[2.5] text-rose-600" />
                <div className="flex flex-col gap-1">
                  <span className="font-display font-black uppercase tracking-tight text-lg">Needs Review</span>
                  <span className="font-sans font-medium text-rose-800">{location.reviewReason}</span>
                </div>
              </div>
            )}
          </div>

          {/* Magazine-style Tabs */}
          <Tabs defaultValue="extracted" className="w-full">
            <TabsList className="flex w-full max-w-sm p-1 bg-card border-2 border-foreground brutal-shadow-sm rounded-xl mb-8">
              <TabsTrigger value="extracted" className="flex-1 font-display font-black text-sm uppercase tracking-wide rounded-lg data-[state=active]:bg-foreground data-[state=active]:text-background transition-all">Extracted Data</TabsTrigger>
              <TabsTrigger value="source" className="flex-1 font-display font-black text-sm uppercase tracking-wide rounded-lg data-[state=active]:bg-foreground data-[state=active]:text-background transition-all">Source Evidence</TabsTrigger>
            </TabsList>
            
            <TabsContent value="extracted" className="space-y-10 animate-in fade-in">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                
                {/* Physical Location Block */}
                <div className="brutal-card rounded-2xl p-6 md:p-8 bg-card relative">
                  <div className="absolute -top-4 -left-4 w-12 h-12 bg-accent border-2 border-foreground brutal-shadow rounded-xl flex items-center justify-center transform -rotate-12 z-10">
                    <MapPin className="w-6 h-6 stroke-[3]" />
                  </div>
                  
                  <h3 className="text-2xl font-display font-black uppercase tracking-tight border-b-2 border-foreground pb-4 mb-6 pl-6">
                    Coordinates
                  </h3>
                  
                  <div className="space-y-5">
                    <Field label="Franchisee Legal Name" isEditing={isEditing}>
                      {isEditing ? (
                        <Input value={formData.franchiseeEntity} onChange={(e) => setFormData({...formData, franchiseeEntity: e.target.value})} className="brutal-input" />
                      ) : (
                        <div className="text-lg font-bold">{location.franchiseeEntity || "—"}</div>
                      )}
                    </Field>

                    <Field label="Franchisor Brand" isEditing={isEditing}>
                      {isEditing ? (
                        <Input value={formData.franchisor} onChange={(e) => setFormData({...formData, franchisor: e.target.value})} className="brutal-input" />
                      ) : (
                        <div className="text-lg font-bold">{location.franchisor || location.franchiseName || "—"}</div>
                      )}
                    </Field>
                    
                    <Field label="Street Address" isEditing={isEditing}>
                      {isEditing ? (
                        <Input value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} className="brutal-input" />
                      ) : (
                        <div className="text-lg font-bold">{location.address || "—"}</div>
                      )}
                    </Field>
                    
                    <div className="grid grid-cols-2 gap-5">
                      <Field label="City" isEditing={isEditing}>
                        {isEditing ? (
                          <Input value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} className="brutal-input" />
                        ) : (
                          <div className="text-lg font-bold">{location.city || "—"}</div>
                        )}
                      </Field>
                      <Field label="State / Prov" isEditing={isEditing}>
                        {isEditing ? (
                          <Input value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} className="brutal-input" />
                        ) : (
                          <div className="text-lg font-bold">{location.state || "—"}</div>
                        )}
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-5">
                      <Field label="Postal Code" isEditing={isEditing}>
                        {isEditing ? (
                          <Input value={formData.zip} onChange={(e) => setFormData({...formData, zip: e.target.value})} className="brutal-input" />
                        ) : (
                          <div className="text-lg font-bold">{location.zip || "—"}</div>
                        )}
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Comms & Status Block */}
                <div className="brutal-card rounded-2xl p-6 md:p-8 bg-card relative">
                  <div className="absolute -top-4 -right-4 w-12 h-12 bg-secondary border-2 border-foreground brutal-shadow rounded-xl flex items-center justify-center transform rotate-12 z-10">
                    <User className="w-6 h-6 stroke-[3]" />
                  </div>

                  <h3 className="text-2xl font-display font-black uppercase tracking-tight border-b-2 border-foreground pb-4 mb-6">
                    Comms & Context
                  </h3>
                  
                  <div className="space-y-5">
                    <Field label="Phone Line" isEditing={isEditing}>
                      {isEditing ? (
                        <Input value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} className="brutal-input" />
                      ) : (
                        <div className="text-lg font-bold flex items-center gap-3">
                          {location.phone ? <><Phone className="w-4 h-4 opacity-50"/> {location.phone}</> : "—"}
                        </div>
                      )}
                    </Field>
                    
                    <Field label="Email Address" isEditing={isEditing}>
                      {isEditing ? (
                        <Input value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} className="brutal-input" />
                      ) : (
                        <div className="text-lg font-bold flex items-center gap-3">
                          {location.email ? <><Mail className="w-4 h-4 opacity-50"/> {location.email}</> : "—"}
                        </div>
                      )}
                    </Field>

                    {location.status === "Former" && (
                      <div className="mt-8 p-4 bg-amber-200 border-2 border-foreground brutal-shadow-sm rounded-xl">
                        <Field label="Exit Reason" isEditing={isEditing} labelClass="text-amber-900">
                          {isEditing ? (
                            <Input value={formData.exitReason} onChange={(e) => setFormData({...formData, exitReason: e.target.value})} className="brutal-input bg-white" />
                          ) : (
                            <div className="text-lg font-black text-amber-950 uppercase tracking-tight leading-tight mt-1">{location.exitReason || "Not specified"}</div>
                          )}
                        </Field>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Extracted Contacts Grid */}
              {location.contacts && location.contacts.length > 0 && (
                <div className="pt-8">
                  <h3 className="text-3xl font-display font-black uppercase tracking-tight border-b-4 border-foreground pb-4 mb-8">
                    Key Personnel
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {location.contacts.map((contact, i) => (
                      <div key={i} className="brutal-card bg-secondary p-5 rounded-2xl flex flex-col gap-3">
                        <div className="text-xl font-display font-black uppercase tracking-tight leading-none bg-foreground text-background px-3 py-2 rounded-lg self-start">
                          {contact.firstName && contact.lastName 
                            ? `${contact.firstName} ${contact.lastName}` 
                            : contact.rawName || "Unnamed"}
                        </div>
                        <div className="font-mono text-sm font-bold text-foreground/80 mt-2 space-y-2">
                          {contact.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4"/> <span className="truncate">{contact.email}</span></div>}
                          {contact.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4"/> <span>{contact.phone}</span></div>}
                          {!contact.email && !contact.phone && <span className="opacity-50">No comms extracted</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="source" className="space-y-6 animate-in fade-in">
              <div className="brutal-card bg-card rounded-2xl overflow-hidden flex flex-col">
                <div className="bg-foreground text-background px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3 font-display font-black text-xl uppercase tracking-tight">
                    <FileText className="w-6 h-6 stroke-[3]" />
                    Raw Evidence Record
                  </div>
                  <div className="px-3 py-1 bg-background text-foreground font-mono text-sm font-bold uppercase tracking-widest rounded-lg">
                    Confidence: {(location.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                
                <div className="p-6 md:p-8 bg-noise border-b-2 border-foreground/20">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
                    <FactBox label="Source File" value={location.sourceDocumentFilename} />
                    <FactBox 
                      label="Source Page" 
                      value={location.sourcePage} 
                      href={location.sourcePage ? `/api/documents/${location.documentId}/pdf#page=${location.sourcePage}` : undefined} 
                    />
                    <FactBox label="Printed Page" value={location.printedPage} />
                    <FactBox label="Exhibit" value={location.sourceExhibit} />
                    <FactBox label="Section" value={location.sourceSection} />
                  </div>
                </div>
                
                <div className="p-6 md:p-8 bg-card">
                  <div className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Extracted Text Chunk</div>
                  <div className="bg-background border-2 border-foreground brutal-shadow-sm rounded-xl p-6 whitespace-pre-wrap font-mono text-sm md:text-base leading-relaxed text-foreground/90 max-h-[500px] overflow-y-auto">
                    {location.rawSourceText || "No raw text available for this extraction."}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

        </div>
      </ScrollArea>
    </div>
  );
}

function Field({ label, children, isEditing, labelClass }: { label: string, children: React.ReactNode, isEditing: boolean, labelClass?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground", labelClass)}>{label}</Label>
      <div className={cn(isEditing ? "mt-1" : "mt-0")}>
        {children}
      </div>
    </div>
  );
}

function FactBox({ label, value, href }: { label: string, value: string | number | null | undefined, href?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-widest text-foreground/60">{label}</div>
      {href && value ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-display font-black text-xl md:text-2xl uppercase tracking-tight flex items-center gap-2 hover:text-primary transition-colors underline decoration-2 underline-offset-4 decoration-foreground/20 hover:decoration-primary">
          {value}
          <ArrowUpRight className="w-5 h-5 stroke-[3]" />
        </a>
      ) : (
        <div className="font-display font-black text-xl md:text-2xl uppercase tracking-tight">{value || "—"}</div>
      )}
    </div>
  );
}
