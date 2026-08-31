import { useSearch, useLocation as useWouterLocation } from "wouter";
import { 
  useListDocuments,
  useListLocations
} from "@workspace/api-client-react";
import { 
  Search, 
  Filter, 
  MapPin, 
  Store, 
  MapPinOff, 
  ClipboardCheck,
  XCircle,
  AlertCircle,
  Building2,
  ListFilter
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationDetail } from "@/components/locations/location-detail";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

const stateOptions = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function Locations() {
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const [wouterLocation, setLocation] = useWouterLocation();
  
  const q = searchParams.get("q") || undefined;
  const statusParam = searchParams.get("status") || undefined;
  const franchisorParam = searchParams.get("franchisor") || undefined;
  const stateParam = searchParams.get("state") || undefined;
  const documentId = searchParams.get("documentId") || undefined;
  const selectedId = searchParams.get("id") || undefined;

  const { data: documents } = useListDocuments();
  const { data: locations, isLoading } = useListLocations({
    q,
    status: statusParam as any,
    franchisor: franchisorParam,
    state: stateParam,
    documentId,
    limit: 100
  });
  const franchisorOptions = Array.from(
    new Set(documents?.map((document) => document.franchiseName).filter(Boolean) ?? []),
  ).sort();

  const updateSearch = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchString);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setLocation(`/locations?${newParams.toString()}`);
  };

  const handleSelect = (id: string) => {
    updateSearch({ id });
  };

  const closeDetail = () => {
    updateSearch({ id: null });
  };

  return (
    <div className="flex h-full w-full bg-background overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-3xl border-4 border-foreground brutal-shadow-lg relative z-10">
      
      {/* Explorer Pane */}
      <div className={cn(
        "flex flex-col border-r-4 border-foreground bg-secondary transition-all duration-300",
        selectedId ? "hidden lg:flex w-full lg:w-[450px] xl:w-[500px] shrink-0" : "w-full flex-1"
      )}>
        
        {/* Search Header */}
        <div className="p-6 border-b-4 border-foreground bg-accent space-y-5 shrink-0 relative z-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-foreground text-background rounded-lg flex items-center justify-center transform -rotate-6 brutal-shadow-sm">
              <MapPin className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-2xl font-display font-black uppercase tracking-tight leading-none">Locations</h2>
              <p className="font-mono text-xs font-bold text-foreground/70 uppercase tracking-widest mt-1">Data Explorer</p>
            </div>
          </div>
          
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground stroke-[3]" />
              <Input 
                placeholder="Search franchisees, cities..."
                className="pl-11 h-12 border-2 border-foreground rounded-xl bg-card text-base font-medium brutal-shadow-sm focus-visible:ring-0 focus-visible:border-primary transition-all"
                defaultValue={q}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateSearch({ q: e.currentTarget.value || null });
                  }
                }}
                onBlur={(e) => updateSearch({ q: e.target.value || null })}
                data-testid="input-locations-search"
              />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                value={franchisorParam || "all"}
                onValueChange={(val) => updateSearch({ franchisor: val === "all" ? null : val })}
              >
                <SelectTrigger className="h-10 border-2 border-foreground rounded-lg bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-xs" data-testid="select-loc-franchisor">
                  <SelectValue placeholder="Brand" />
                </SelectTrigger>
                <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-xs">
                  <SelectItem value="all">All Brands</SelectItem>
                  {franchisorOptions.map((franchisor) => (
                    <SelectItem key={franchisor} value={franchisor}>{franchisor}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={stateParam || "all"}
                onValueChange={(val) => updateSearch({ state: val === "all" ? null : val })}
              >
                <SelectTrigger className="h-10 border-2 border-foreground rounded-lg bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-xs" data-testid="select-loc-state">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-xs max-h-[300px]">
                  <SelectItem value="all">All States</SelectItem>
                  {stateOptions.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusParam || "all"}
                onValueChange={(val) => updateSearch({ status: val === "all" ? null : val })}
              >
                <SelectTrigger className="h-10 border-2 border-foreground rounded-lg bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-xs" data-testid="select-loc-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-xs">
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Current">Current</SelectItem>
                  <SelectItem value="Former">Former</SelectItem>
                  <SelectItem value="Planning">Planning</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(documentId || franchisorParam || stateParam || statusParam) && (
            <div className="flex items-center justify-between bg-foreground text-background px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-widest brutal-shadow-sm">
              <span className="flex items-center gap-2">
                <ListFilter className="w-4 h-4" /> Filters Active
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-background/20 hover:text-background text-background/80 rounded"
                onClick={() => updateSearch({ documentId: null, franchisor: null, state: null, status: null, q: null })}
                data-testid="button-clear-filters"
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* List Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 relative z-10 bg-secondary/50">
          {isLoading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className="brutal-card rounded-xl p-4 space-y-3">
                <Skeleton className="h-6 w-3/4 bg-foreground/10 rounded" />
                <Skeleton className="h-4 w-1/2 bg-foreground/10 rounded" />
                <div className="flex justify-between pt-2">
                  <Skeleton className="h-6 w-20 bg-foreground/10 rounded-full" />
                  <Skeleton className="h-6 w-16 bg-foreground/10 rounded-full" />
                </div>
              </div>
            ))
          ) : locations?.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center px-4">
              <div className="w-16 h-16 border-2 border-foreground bg-background rounded-xl flex items-center justify-center mb-4 opacity-50 transform rotate-6">
                <MapPin className="w-8 h-8 stroke-[2]" />
              </div>
              <h3 className="text-xl font-display font-black uppercase tracking-tight">No Results</h3>
              <p className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-widest mt-2">Adjust your filters</p>
            </div>
          ) : (
            locations?.map((loc) => {
              const StatusIcon = 
                loc.status === "Current" ? Store :
                loc.status === "Former" ? MapPinOff : ClipboardCheck;
              
              const isSelected = selectedId === loc.id;
              
              return (
                <div
                  key={loc.id}
                  onClick={() => handleSelect(loc.id)}
                  data-testid={`location-card-${loc.id}`}
                  className={cn(
                    "p-4 rounded-xl border-2 transition-all cursor-pointer brutal-shadow-sm group",
                    isSelected 
                      ? "bg-primary border-foreground text-primary-foreground translate-x-1" 
                      : "bg-card border-foreground hover:-translate-y-1 hover:brutal-shadow-hover"
                  )}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="font-display font-black text-lg uppercase tracking-tight leading-tight line-clamp-2">
                      {loc.franchiseeEntity || loc.franchiseName}
                    </div>
                    {loc.reviewStatus === "Needs review" && (
                      <AlertCircle className={cn("w-5 h-5 shrink-0 stroke-[2.5]", isSelected ? "text-primary-foreground" : "text-rose-500")} />
                    )}
                  </div>
                  
                  <div className={cn("font-mono text-xs font-bold uppercase tracking-widest mb-1.5", isSelected ? "text-primary-foreground/90" : "text-muted-foreground")}>
                    {loc.franchisor || loc.franchiseName}
                  </div>
                  
                  <div className={cn("font-sans font-medium text-sm mb-4 line-clamp-1", isSelected ? "text-primary-foreground/90" : "text-foreground/80")}>
                    {loc.city && loc.state ? `${loc.city}, ${loc.state}` : loc.address || "Address not extracted"}
                  </div>
                  
                  <div className="flex items-center justify-between pt-3 border-t-2 border-foreground/10">
                    <div className={cn(
                      "flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border-2 border-transparent",
                      isSelected ? "text-primary-foreground border-primary-foreground/20 bg-primary-foreground/10" : 
                      loc.status === "Current" ? "text-emerald-700 bg-emerald-100 border-emerald-200" :
                      loc.status === "Former" ? "text-amber-700 bg-amber-100 border-amber-200" : "text-blue-700 bg-blue-100 border-blue-200"
                    )}>
                      <StatusIcon className="w-3.5 h-3.5 stroke-[2.5]" />
                      {loc.status}
                    </div>
                    
                    <div className={cn("font-mono text-xs font-bold uppercase tracking-widest flex items-center gap-1", isSelected ? "text-primary-foreground" : "text-foreground/60")}>
                      {(loc.confidence * 100).toFixed(0)}% CONF
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Detail Pane */}
      <div className={cn(
        "flex-1 bg-background flex flex-col min-w-0 transition-all",
        !selectedId && "hidden lg:flex items-center justify-center bg-noise"
      )}>
        {selectedId ? (
          <LocationDetail 
            id={selectedId} 
            onClose={closeDetail} 
          />
        ) : (
          <div className="text-center max-w-md p-8 brutal-card rounded-2xl bg-card border-dashed border-4 border-foreground/20 shadow-none">
            <Building2 className="w-20 h-20 mx-auto mb-6 text-foreground/20 stroke-[1.5]" />
            <h3 className="text-3xl font-display font-black uppercase tracking-tight text-foreground/40">Select a Location</h3>
            <p className="mt-4 font-mono text-sm font-bold uppercase tracking-widest text-foreground/40 leading-relaxed">
              Choose a location from the explorer to review extracted data, check source text, and edit details.
            </p>
          </div>
        )}
      </div>
      
    </div>
  );
}