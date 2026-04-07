import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useLang } from "@/lib/i18n";

function useIsIOS() {
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsIOS(ios);
    setIsStandalone(standalone);
  }, []);
  return { isIOS, isStandalone };
}

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { canInstall, isInstalling, install } = usePWAInstall();
  const { isIOS, isStandalone } = useIsIOS();
  const { lang, setLang, t } = useLang();

  const navItems = [
    { href: "/", label: t("nav_home") },
    { href: "/activities", label: t("nav_activities") },
    { href: "/live", label: t("nav_live") },
    { href: "/upload", label: t("nav_upload") },
  ];
  const [iosBannerDismissed, setIosBannerDismissed] = useState(false);
  const isOnline = useOnlineStatus();

  const showIOSBanner = isIOS && !isStandalone && !canInstall && !iosBannerDismissed;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-600">
            <path d="M1 6c3.18-3.2 8.28-4.5 12.9-3.1"/><path d="M5 10a9.9 9.9 0 0 1 5.26-2.93"/><path d="M10.7 14.1A4 4 0 0 1 16 18"/><path d="m2 2 20 20"/><path d="M8.5 8.5A9.86 9.86 0 0 0 3 14"/><path d="M16.72 11.06A10 10 0 0 1 19 12.93"/>
          </svg>
          <p className="text-xs text-amber-800 leading-snug">
            <strong>Sei offline.</strong> Le attività salvate sono disponibili, ma la mappa di sfondo e il caricamento di nuovi file GPX richiedono una connessione.
          </p>
        </div>
      )}

      {/* iOS install hint */}
      {showIOSBanner && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            <span>
              Su iPhone apri questa pagina in <strong>Safari</strong>, poi tocca{" "}
              <strong>Condividi</strong> e scegli <strong>Aggiungi a schermata Home</strong>.
            </span>
          </div>
          <button
            onClick={() => setIosBannerDismissed(true)}
            className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
            aria-label="Chiudi"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Install banner */}
      {canInstall && (
        <div className="bg-primary text-white px-4 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v13M8 11l4 4 4-4"/>
              <path d="M20 21H4"/>
            </svg>
            <span className="font-medium">Installa RunReel sul tuo dispositivo per usarla offline</span>
          </div>
          <button
            onClick={install}
            disabled={isInstalling}
            className="flex-shrink-0 px-4 py-1.5 bg-white text-primary rounded-lg text-sm font-bold hover:bg-white/90 transition-colors disabled:opacity-70"
          >
            {isInstalling ? "Installazione..." : "Installa"}
          </button>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-border shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <span className="cursor-pointer flex flex-col leading-tight">
              <span className="font-black text-xl tracking-tight">
                <span className="text-primary">Run</span>
                <span className="text-foreground">Reel</span>
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">v 0.37</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                      isActive
                        ? "bg-primary text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === "it" ? "en" : "it")}
              className="ml-1 px-2 py-1 rounded-md text-xs font-bold text-muted-foreground hover:text-primary hover:bg-muted transition-colors border border-border"
              title="Cambia lingua / Change language"
            >
              {t("lang_toggle")}
            </button>
            {canInstall && (
              <button
                onClick={install}
                disabled={isInstalling}
                title="Installa RunReel"
                className="ml-1 p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v13M8 11l4 4 4-4"/>
                  <path d="M20 21H4"/>
                </svg>
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>


    </div>
  );
}
