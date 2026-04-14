import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { getDeviceId } from "@/lib/device";

export default function StravaCallback() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error || !code) {
      setStatus("error");
      setTimeout(() => navigate("/activities"), 2000);
      return;
    }

    fetch("/api/strava/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Id": getDeviceId() },
      body: JSON.stringify({ code }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Exchange failed");
        navigate("/activities#strava=ok");
      })
      .catch(() => {
        setStatus("error");
        setTimeout(() => navigate("/activities"), 2000);
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-3">
        <svg viewBox="0 0 24 24" className="w-12 h-12 mx-auto" fill="#FC4C02">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        {status === "loading" ? (
          <>
            <p className="font-semibold text-lg">Connessione Strava in corso…</p>
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </>
        ) : (
          <>
            <p className="font-semibold text-lg text-destructive">Errore di connessione</p>
            <p className="text-sm text-muted-foreground">Torno alle attività…</p>
          </>
        )}
      </div>
    </div>
  );
}
