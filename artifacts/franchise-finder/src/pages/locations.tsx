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
  ListFilter,
  ChevronLeft,
  ChevronRight,
  Phone
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationDetail } from "@/components/locations/location-detail";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  const reviewStatus = searchParams.get("reviewStatus") || undefined;
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const selectedId = searchParams.get("id") || undefined;
  const pageSize = 50;

  const { data: documents } = useListDocuments();
  const { data: locations, isLoading } = useListLocations({
    q,
    status: statusParam as any,
    franchisor: franchisorParam,
    state: stateParam,
    documentId,
    reviewStatus: reviewStatus as any,
    limit: pageSize,
    offset,
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

  const updateFilters = (updates: Record<string, string | null>) => {
    updateSearch({ ...updates, offset: null, id: null });
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
        selectedId ? "hidden lg:flex w-full lg:w-[56%] shrink-0" : "w-full flex-1"
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
                    updateFilters({ q: e.currentTarget.value || null });
                  }
                }}
                onBlur={(e) => updateFilters({ q: e.target.value || null })}
                data-testid="input-locations-search"
              />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <Select
                value={franchisorParam || "all"}
                onValueChange={(val) => updateFilters({ franchisor: val === "all" ? null : val })}
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
                onValueChange={(val) => updateFilters({ state: val === "all" ? null : val })}
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
                onValueChange={(val) => updateFilters({ status: val === "all" ? null : val })}
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
              <Select
                value={reviewStatus || "all"}
                onValueChange={(val) => updateFilters({ reviewStatus: val === "all" ? null : val })}
              >
                <SelectTrigger className="h-10 border-2 border-foreground rounded-lg bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-xs" data-testid="select-loc-review">
                  <SelectValue placeholder="Review" />
                </SelectTrigger>
                <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-xs">
                  <SelectItem value="all">All Review</SelectItem>
                  <SelectItem value="Needs review">Needs Review</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(documentId || franchisorParam || stateParam || statusParam || reviewStatus || q) && (
            <div className="flex items-center justify-between bg-foreground text-background px-4 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-widest brutal-shadow-sm">
              <span className="flex items-center gap-2">
                <ListFilter className="w-4 h-4" /> Filters Active
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-background/20 hover:text-background text-background/80 rounded"
                onClick={() => updateSearch({ documentId: null, franchisor: null, state: null, status: null, reviewStatus: null, q: null, offset: null, id: null })}
                data-testid="button-clear-filters"
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Data table */}
        <div className="flex-1 min-h-0 flex flex-col relative z-10 bg-secondary/50">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array(8).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full bg-foreground/10 rounded-lg" />
              ))}
            </div>
          ) : locations?.length === 0 ? (
            <div className="py-20 text-center flex flex-col items-center px-4">
              <div className="w-16 h-16 border-2 border-foreground bg-background rounded-xl flex items-center justify-center mb-4 opacity-50 transform rotate-6">
                <MapPin className="w-8 h-8 stroke-[2]" />
              </div>
              <h3 className="text-xl font-display font-black uppercase tracking-tight">No Results</h3>
              <p className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-widest mt-2">Adjust your filters</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-auto">
                <Table className="min-w-[900px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow className="border-b-2 border-foreground hover:bg-card">
                      <TableHead>Franchisee / Entity</TableHead>
                      <TableHead>Brand</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Review</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {locations?.map((loc) => {
                      const isSelected = selectedId === loc.id;
                      return (
                        <TableRow
                          key={loc.id}
                          onClick={() => handleSelect(loc.id)}
                          data-testid={`location-row-${loc.id}`}
                          className={cn(
                            "cursor-pointer border-b border-foreground/15",
                            isSelected ? "bg-primary/15" : "bg-card hover:bg-accent/60",
                          )}
                        >
                          <TableCell className="font-semibold max-w-[260px]">
                            <div className="truncate">{loc.franchiseeEntity || "Franchisee not identified"}</div>
                            {loc.locationCode && <div className="text-xs text-muted-foreground mt-1">#{loc.locationCode}</div>}
                          </TableCell>
                          <TableCell className="font-medium">{loc.franchisor || loc.franchiseName}</TableCell>
                          <TableCell>
                            <div>{loc.city && loc.state ? `${loc.city}, ${loc.state}` : "Location incomplete"}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[220px]">{loc.address || "Address not extracted"}</div>
                          </TableCell>
                          <TableCell>
                            <span className={cn(
                              "inline-flex rounded-full border px-2 py-1 text-xs font-semibold",
                              loc.status === "Current" ? "bg-emerald-100 text-emerald-800" :
                              loc.status === "Former" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800",
                            )}>{loc.status}</span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {loc.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{loc.phone}</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold",
                              loc.reviewStatus === "Approved" ? "bg-emerald-100 text-emerald-800" :
                              loc.reviewStatus === "Rejected" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-900",
                            )}>
                              {loc.reviewStatus === "Needs review" && <AlertCircle className="h-3.5 w-3.5" />}
                              {loc.reviewStatus}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{Math.round(loc.confidence * 100)}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between border-t-2 border-foreground bg-card px-4 py-3">
                <div className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
                  Showing {offset + 1}–{offset + (locations?.length ?? 0)}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => updateSearch({ offset: String(Math.max(0, offset - pageSize)), id: null })}
                  ><ChevronLeft className="h-4 w-4" /> Previous</Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(locations?.length ?? 0) < pageSize}
                    onClick={() => updateSearch({ offset: String(offset + pageSize), id: null })}
                  >Next <ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </>
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
