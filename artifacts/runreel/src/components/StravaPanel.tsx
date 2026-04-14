import { useState, useEffect } from "react";
import { useLang } from "@/lib/i18n";
import { getDeviceId } from "@/lib/device";

interface StravaStatus {
  connected: boolean;
  configured: boolean;
  athleteName?: string;
  lastSyncAt?: string | null;
}

interface SyncResult {
  imported: number;
  total: number;
}

function stravaFetch(path: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), "X-Device-Id": getDeviceId() },
  });
}

export default function StravaPanel({ onSynced }: { onSynced?: () => void }) {
  const { lang } = useLang();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    stravaFetch("/api/strava/status").then(r => r.json()).then(setStatus).catch(() => {});
    // Controlla hash per redirect post-OAuth
    if (window.location.hash === "#strava=ok") {
      window.location.hash = "";
      setOpen(true);
    }
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await stravaFetch("/api/strava/sync", { method: "POST" });
      const data = await res.json() as SyncResult;
      setSyncResult(data);
      onSynced?.();
      // Refresh status
      const st = await stravaFetch("/api/strava/status").then(r => r.json()) as StravaStatus;
      setStatus(st);
    } catch { /* ignore */ } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(lang === "it" ? "Disconnettere Strava?" : "Disconnect Strava?")) return;
    await stravaFetch("/api/strava/disconnect", { method: "DELETE" });
    setStatus({ connected: false, configured: true });
    setSyncResult(null);
  };

  if (!status) return null;
  if (!status.configured) return null; // Strava non configurato, nascondi silenziosamente

  const _labels = {
    it: {
      title: "Strava",
      connect: "Connetti Strava",
      sync: "Sincronizza",
      syncing: "Sincronizzazione…",
      disconnect: "Disconnetti",
      connected: "Connesso come",
      lastSync: "Ultima sync",
      never: "mai",
      imported: (n: number, tot: number) => `${n} nuove attività importate (${tot} totali)`,
      noNew: "Nessuna nuova attività",
      notConnected: "Connetti il tuo account Strava per importare le attività in automatico.",
    },
    en: {
      title: "Strava",
      connect: "Connect Strava",
      sync: "Sync now",
      syncing: "Syncing…",
      disconnect: "Disconnect",
      connected: "Connected as",
      lastSync: "Last sync",
      never: "never",
      imported: (n: number, tot: number) => `${n} new activities imported (${tot} total)`,
      noNew: "No new activities",
      notConnected: "Connect your Strava account to automatically import activities.",
    },
  };
  const label = _labels[lang as "it" | "en"] ?? _labels.en;

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/40 transition-colors text-left"
      >
        {/* Strava orange icon */}
        <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="#FC4C02">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        <span className="font-semibold text-sm flex-1">{label.title}</span>
        {status.connected && (
          <span className="text-xs text-green-500 font-medium">● {label.connected} {status.athleteName}</span>
        )}
        <svg viewBox="0 0 24 24" className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 bg-card border-t border-border space-y-3">
          {status.connected ? (
            <>
              <p className="text-xs text-muted-foreground">
                {label.lastSync}: {status.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleString(lang === "it" ? "it-IT" : "en-US")
                  : label.never}
              </p>
              {syncResult && (
                <p className="text-xs font-medium text-primary">
                  {syncResult.imported > 0 ? label.imported(syncResult.imported, syncResult.total) : label.noNew}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex-1 px-3 py-2 text-sm font-semibold bg-[#FC4C02] text-white rounded-lg hover:bg-[#e04402] disabled:opacity-60 transition-colors"
                >
                  {syncing ? label.syncing : label.sync}
                </button>
                <button
                  onClick={handleDisconnect}
                  className="px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  {label.disconnect}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{label.notConnected}</p>
              <a
                href="/api/strava/connect"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[#FC4C02] text-white rounded-lg hover:bg-[#e04402] transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
                {label.connect}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
