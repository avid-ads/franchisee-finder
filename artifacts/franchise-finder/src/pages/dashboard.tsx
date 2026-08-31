import { Link, useLocation as useWouterLocation } from "wouter";
import { useState } from "react";
import {
  getGetStatsQueryKey,
  useGetStats,
  useListDocuments,
  useHealthCheck,
} from "@workspace/api-client-react";
import { 
  Building2, 
  FileText, 
  Store, 
  MapPinOff, 
  ClipboardCheck, 
  AlertCircle,
  ArrowRight,
  Upload,
  Calendar,
  Clock,
  Search,
  Sparkles,
  ArrowUpRight,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const stateOptions = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

export default function Dashboard() {
  const { data: documents, isLoading: docsLoading } = useListDocuments();
  const { data: stats, isLoading: statsLoading } = useGetStats({
    query: {
      queryKey: getGetStatsQueryKey(),
      refetchInterval: documents?.some((document) => document.processingStatus === "Processing")
        ? 2_000
        : 15_000,
    },
  });
  const { data: health, isLoading: healthLoading, isError: healthError } = useHealthCheck();
  const [, setLocation] = useWouterLocation();
  const [search, setSearch] = useState("");
  const [franchisor, setFranchisor] = useState("all");
  const [state, setState] = useState("all");
  const [status, setStatus] = useState("all");

  const recentDocs = documents?.slice(0, 5) || [];
  const franchisorOptions = Array.from(
    new Set(documents?.map((document) => document.franchiseName).filter(Boolean) ?? []),
  ).sort();

  const handleLocationSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (franchisor !== "all") params.set("franchisor", franchisor);
    if (state !== "all") params.set("state", state);
    if (status !== "all") params.set("status", status);
    const query = params.toString();
    setLocation(query ? `/locations?${query}` : "/locations");
  };

  return (
    <div className="max-w-7xl mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b-4 border-foreground pb-8">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-accent border-2 border-foreground brutal-shadow-sm rounded-full text-xs font-mono font-bold uppercase tracking-wider mb-6">
            <Sparkles className="w-3.5 h-3.5" /> FDD Intelligence Engine
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-black tracking-tighter text-foreground uppercase leading-[0.9] mb-4">
            Intelligence<br/><span className="text-primary">Workspace</span>
          </h1>
          <p className="text-lg md:text-xl font-medium text-foreground/80 max-w-xl font-sans">
            Turn dense FDD PDFs into actionable franchise intelligence with zero fluff.
          </p>
        </div>
        <Link href="/documents" data-testid="link-upload-fdd">
          <Button size="lg" className="brutal-btn rounded-xl text-base px-8 py-6 gap-3 group bg-primary text-primary-foreground">
            <Upload className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
            Upload New FDD
          </Button>
        </Link>
      </div>

      {/* Global Search Bar */}
      <div className="brutal-card rounded-2xl p-6 md:p-8 bg-secondary">
        <div className="flex items-center gap-3 mb-6">
          <Search className="w-6 h-6 stroke-[3]" />
          <h2 className="text-2xl font-display font-black uppercase tracking-tight">Find Locations</h2>
        </div>
        
        <form onSubmit={handleLocationSearch} className="flex flex-col md:flex-row gap-4" data-testid="form-location-search">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground stroke-[3]" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search franchisees, addresses..."
              aria-label="Search franchise locations"
              className="h-14 pl-12 border-2 border-foreground rounded-xl bg-card text-lg font-medium shadow-none focus-visible:ring-0 focus-visible:border-primary brutal-shadow-sm transition-all"
              data-testid="input-global-search"
            />
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 md:flex md:w-auto">
            <Select value={franchisor} onValueChange={setFranchisor}>
              <SelectTrigger className="h-14 border-2 border-foreground rounded-xl bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-sm md:w-[180px]" data-testid="select-franchisor">
                <SelectValue placeholder="Franchisor" />
              </SelectTrigger>
              <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-sm">
                <SelectItem value="all">All Brands</SelectItem>
                {franchisorOptions.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={state} onValueChange={setState}>
              <SelectTrigger className="h-14 border-2 border-foreground rounded-xl bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-sm md:w-[140px]" data-testid="select-state">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-sm max-h-[300px]">
                <SelectItem value="all">All States</SelectItem>
                {stateOptions.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-14 border-2 border-foreground rounded-xl bg-card brutal-shadow-sm font-bold uppercase tracking-wider text-sm md:w-[160px]" data-testid="select-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="border-2 border-foreground brutal-shadow rounded-xl font-bold uppercase tracking-wider text-sm">
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Current">Current</SelectItem>
                <SelectItem value="Former">Former</SelectItem>
                <SelectItem value="Planning">Planning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <Button type="submit" className="h-14 bg-foreground text-background hover:bg-foreground/90 border-2 border-foreground rounded-xl font-display font-black text-lg px-8 uppercase brutal-shadow-sm brutal-shadow-hover" data-testid="button-search-submit">
            Go
          </Button>
        </form>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 md:gap-6">
        <StatCard title="Docs" value={stats?.documents} icon={FileText} loading={statsLoading} bgClass="bg-card" />
        <StatCard title="Locations" value={stats?.totalLocations} icon={Store} loading={statsLoading} bgClass="bg-primary text-primary-foreground" borderClass="border-foreground" />
        <StatCard title="Current" value={stats?.current} icon={Store} loading={statsLoading} bgClass="bg-emerald-300" />
        <StatCard title="Former" value={stats?.former} icon={MapPinOff} loading={statsLoading} bgClass="bg-amber-300" />
        <StatCard title="Planning" value={stats?.planning} icon={ClipboardCheck} loading={statsLoading} bgClass="bg-blue-300" />
        <StatCard title="Review" value={stats?.needsReview} icon={AlertCircle} loading={statsLoading} bgClass="bg-rose-400 text-foreground" />
      </div>

      {/* Two Column Layout for Docs & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Recent Documents */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-end justify-between border-b-2 border-foreground pb-4">
            <div>
              <h2 className="text-3xl font-display font-black uppercase tracking-tight">Recent FDDs</h2>
              <p className="text-muted-foreground font-medium font-mono text-sm mt-1 uppercase tracking-wider">Latest processed data</p>
            </div>
            <Link href="/documents">
              <Button variant="ghost" className="font-bold uppercase tracking-wider gap-2 hover:bg-transparent hover:translate-x-1 transition-transform">
                View All <ArrowUpRight className="w-5 h-5 stroke-[3]" />
              </Button>
            </Link>
          </div>

          <div className="space-y-4">
            {docsLoading ? (
              [...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl border-2 border-foreground" />
              ))
            ) : recentDocs.length > 0 ? (
              recentDocs.map((doc) => (
                <Link key={doc.id} href={`/locations?documentId=${doc.id}`} data-testid={`link-doc-${doc.id}`}>
                  <div className="group brutal-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer hover:bg-accent transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-background border-2 border-foreground rounded-xl flex items-center justify-center shrink-0 brutal-shadow-sm group-hover:rotate-6 transition-transform">
                        <Building2 className="w-6 h-6 stroke-[2.5]" />
                      </div>
                      <div>
                        <h4 className="text-xl font-display font-black uppercase tracking-tight flex items-center gap-3">
                          {doc.franchiseName}
                          {doc.fddYear && (
                            <span className="font-mono text-xs bg-foreground text-background px-2 py-0.5 rounded uppercase tracking-widest">{doc.fddYear}</span>
                          )}
                        </h4>
                        <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-muted-foreground mt-2 font-mono">
                          <span className="flex items-center gap-1.5 text-foreground/70">
                            <FileText className="w-4 h-4" /> {doc.filename}
                          </span>
                          <span className="flex items-center gap-1.5 text-foreground/70">
                            <Calendar className="w-4 h-4" /> 
                            {format(parseISO(doc.uploadDate), "MMM d, yy")}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 self-start sm:self-center">
                      {doc.locationCount > 0 && (
                        <div className="font-mono text-sm font-bold flex items-center gap-2">
                          <Store className="w-4 h-4" />
                          {doc.locationCount} LOC
                        </div>
                      )}
                      <div className={cn(
                        "px-3 py-1 border-2 border-foreground font-bold text-xs uppercase tracking-wider rounded-full",
                        ["Completed", "Ready"].includes(doc.processingStatus) ? "bg-emerald-300" :
                        doc.processingStatus === "Needs review" ? "bg-amber-300" :
                        doc.processingStatus === "Failed" ? "bg-rose-400" : "bg-accent animate-pulse"
                      )}>
                        {doc.processingStatus}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="brutal-card rounded-2xl p-12 text-center flex flex-col items-center justify-center bg-card/50 border-dashed border-4 border-muted-foreground/30 shadow-none">
                <FileText className="w-16 h-16 text-muted-foreground mb-4" />
                <h3 className="text-2xl font-display font-black uppercase tracking-tight">No FDDs Yet</h3>
                <p className="font-medium text-muted-foreground mb-6">Upload your first document to start extracting intelligence.</p>
                <Link href="/documents">
                  <Button className="brutal-btn rounded-xl">Upload FDD</Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Activity Sidebar */}
        <div className="space-y-6">
          <div className="border-b-2 border-foreground pb-4">
            <h2 className="text-3xl font-display font-black uppercase tracking-tight">Pipeline</h2>
            <p className="text-muted-foreground font-medium font-mono text-sm mt-1 uppercase tracking-wider">System Activity</p>
          </div>

          <div className="brutal-card rounded-2xl p-6 bg-card relative overflow-hidden">
            {/* Background graphic */}
            <Activity className="absolute -right-8 -bottom-8 w-48 h-48 text-muted/30 stroke-[1]" />
            
            <div className="relative z-10 space-y-6">
              {docsLoading ? (
                [...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl border-2 border-foreground" />
                ))
              ) : recentDocs.filter(d => d.stages && d.stages.length > 0).length > 0 ? (
                recentDocs.slice(0, 4).map((doc) => {
                  const latestStage = doc.stages[doc.stages.length - 1];
                  const isDone = latestStage.status === "Complete" || latestStage.status === "Completed";
                  return (
                    <div key={doc.id} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={cn(
                          "w-4 h-4 rounded-full border-2 border-foreground z-10",
                          isDone ? "bg-emerald-400" : "bg-accent animate-pulse"
                        )} />
                        <div className="w-0.5 h-full bg-foreground/20 -mt-2 -mb-6" />
                      </div>
                      <div className="pb-6 w-full">
                        <div className="font-bold text-sm uppercase tracking-wide truncate">{doc.franchiseName}</div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="font-mono text-xs text-muted-foreground truncate pr-2">{latestStage.stage}</span>
                          <span className={cn("font-bold text-xs uppercase tracking-wider shrink-0", 
                            isDone ? "text-emerald-600" : "text-amber-600"
                          )}>
                            {latestStage.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 font-mono text-sm text-muted-foreground">
                  No active pipeline tasks.
                </div>
              )}
            </div>
            
            <div className="mt-8 pt-4 border-t-2 border-foreground/10 font-mono text-xs font-bold uppercase tracking-widest flex items-center justify-between">
              <span>Status</span>
              <span className={healthLoading ? "text-amber-700" : health?.status === "ok" ? "text-emerald-600" : "text-destructive"}>
                {healthLoading ? "Checking" : healthError ? "Unavailable" : health?.status === "ok" ? "Operational" : "Degraded"}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  loading,
  bgClass = "bg-card",
  borderClass = "border-foreground"
}: { 
  title: string; 
  value?: number; 
  icon: any; 
  loading: boolean;
  bgClass?: string;
  borderClass?: string;
}) {
  return (
    <div className={cn("brutal-card rounded-2xl p-4 flex flex-col justify-between aspect-square", bgClass, borderClass)}>
      <div className="flex justify-between items-start mb-4">
        <Icon className="w-6 h-6 stroke-[2.5]" />
      </div>
      <div>
        {loading ? (
          <Skeleton className="h-10 w-16 mb-2 bg-foreground/20" />
        ) : (
          <div className="text-4xl lg:text-5xl font-display font-black tracking-tighter mb-1">
            {value?.toLocaleString() || "0"}
          </div>
        )}
        <div className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-widest opacity-80 leading-tight">
          {title}
        </div>
      </div>
    </div>
  );
}
