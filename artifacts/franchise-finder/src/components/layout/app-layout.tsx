import { Link, useLocation } from "wouter";
import {
  FileText, 
  LayoutDashboard, 
  MapPin,
  Flame
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health, isLoading: healthLoading, isError: healthError } = useHealthCheck();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/documents", label: "Documents", icon: FileText },
    { href: "/locations", label: "Locations", icon: MapPin },
  ];

  return (
    <div className="flex h-screen bg-background bg-noise text-foreground font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r-2 border-foreground bg-sidebar flex flex-col hidden md:flex shrink-0 relative z-20">
        <div className="h-20 flex items-center px-6 border-b-2 border-foreground gap-3 bg-accent brutal-shadow-sm mb-4 mx-4 mt-4 rounded-xl">
          <div className="bg-foreground text-background p-1.5 rounded-lg transform -rotate-6 shadow-sm">
            <Flame className="w-6 h-6 text-primary" />
          </div>
          <span className="font-display font-black tracking-tighter text-xl uppercase">Franchise<br/>Finder</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-3 mt-4 overflow-y-auto">
          <div className="text-xs font-mono font-bold text-muted-foreground uppercase tracking-widest mb-2 px-2">Navigation</div>
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold uppercase tracking-wide transition-all duration-200 border-2",
                  isActive 
                    ? "bg-primary text-primary-foreground border-foreground brutal-shadow-sm translate-x-1" 
                    : "bg-transparent border-transparent hover:border-foreground hover:bg-card hover:brutal-shadow-sm text-foreground/80 hover:text-foreground hover:translate-x-1"
                )}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="w-5 h-5 stroke-[2.5]" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto">
          <div className="brutal-card rounded-xl p-4 flex items-center gap-3 text-sm font-bold uppercase tracking-wider bg-card">
            <div className={cn(
              "w-3 h-3 rounded-full border-2 border-foreground",
              healthLoading ? "bg-amber-300 animate-pulse" : health?.status === "ok" ? "bg-emerald-400" : "bg-destructive",
            )} />
            <span>Sys Status: {healthLoading ? "CHECK" : healthError ? "ERR" : health?.status === "ok" ? "OK" : "ERR"}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        <header className="h-16 border-b-2 border-foreground bg-primary flex items-center px-6 md:hidden shrink-0">
          <div className="flex items-center gap-2 text-primary-foreground font-display font-black tracking-tight text-xl uppercase">
            <Flame className="w-6 h-6" />
            Franchisee Finder
          </div>
        </header>
        <div className="flex-1 overflow-auto relative">
          <div className="min-h-full p-4 pb-24 md:p-8">
            {children}
          </div>
        </div>

        <nav
          className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-3 gap-1 rounded-2xl border-2 border-foreground bg-card p-1.5 shadow-[4px_4px_0_0_hsl(var(--foreground))] md:hidden"
          aria-label="Mobile navigation"
        >
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-accent",
                )}
                data-testid={`mobile-nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="h-4 w-4 stroke-[2.5]" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </main>
    </div>
  );
}
