import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  useStartLiveSession,
  useAddLivePoint,
  useStopLiveSession,
  useGetLiveSession,
  getGetLiveSessionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListActivitiesQueryKey, getGetStatsSummaryQueryKey } from "@workspace/api-client-react";

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return "--:--";
  return `${Math.floor(secPerKm / 60)}:${(secPerKm % 60).toString().padStart(2, "0")}`;
}

// Simple canvas map for live view
function LiveMap({ points, currentPos }: {
  points: Array<{ lat: number; lon: number }>;
  currentPos: { lat: number; lon: number } | null;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const polylineRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      import("leaflet/dist/leaflet.css");
      const map = L.map(mapRef.current!, { zoomControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);

      if (currentPos) {
        map.setView([currentPos.lat, currentPos.lon], 15);
      }

      const poly = L.polyline([], { color: "#E11D48", weight: 4, opacity: 0.9 }).addTo(map);
      polylineRef.current = poly;

      const icon = L.divIcon({
        html: '<div style="width:16px;height:16px;border-radius:50%;background:#E11D48;border:3px solid white;box-shadow:0 0 8px rgba(225,29,72,0.6);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        className: "",
      });
      const marker = L.marker([0, 0], { icon }).addTo(map);
      markerRef.current = marker;

      mapInstanceRef.current = map;
    });

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove(): void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !polylineRef.current) return;
    const L = window.L;
    if (!L) return;

    const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
    (polylineRef.current as { setLatLngs(lls: [number, number][]): void }).setLatLngs(latlngs);

    if (currentPos) {
      (markerRef.current as { setLatLng(ll: [number, number]): void })?.setLatLng([currentPos.lat, currentPos.lon]);
      (mapInstanceRef.current as { panTo(ll: [number, number]): void }).panTo([currentPos.lat, currentPos.lon]);
    }
  }, [points, currentPos]);

  return <div ref={mapRef} className="w-full h-full" />;
}

export default function Live() {
  const [, navigate] = useLocation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [localPoints, setLocalPoints] = useState<Array<{ lat: number; lon: number }>>([]);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lon: number } | null>(null);
  const [localDuration, setLocalDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  const startSession = useStartLiveSession();
  const addPoint = useAddLivePoint();
  const stopSession = useStopLiveSession();

  const { data: session } = useGetLiveSession(sessionId ?? "", {
    query: {
      enabled: !!sessionId && isTracking,
      refetchInterval: 3000,
      queryKey: getGetLiveSessionQueryKey(sessionId ?? ""),
    },
  });

  const handleStart = async () => {
    setError(null);
    try {
      const result = await startSession.mutateAsync({});
      setSessionId(result.sessionId);
      setIsTracking(true);
      setLocalPoints([]);
      setLocalDuration(0);

      timerRef.current = setInterval(() => {
        setLocalDuration((d) => d + 1);
      }, 1000);

      if (!navigator.geolocation) {
        setError("Geolocalizzazione non supportata dal browser.");
        return;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const point = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            ele: pos.coords.altitude ?? undefined,
            time: new Date().toISOString(),
          };
          setCurrentPos({ lat: point.lat, lon: point.lon });
          setLocalPoints((prev) => [...prev, point]);

          if (result.sessionId) {
            addPoint.mutate({
              sessionId: result.sessionId,
              data: point,
            });
          }
        },
        (err) => {
          setError("Impossibile ottenere la posizione GPS: " + err.message);
        },
        { enableHighAccuracy: true, maximumAge: 0 }
      );
    } catch {
      setError("Impossibile avviare la sessione. Riprova.");
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const result = await stopSession.mutateAsync({ sessionId });
      setIsTracking(false);
      setSessionId(null);
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
      navigate(`/activities/${result.id}`);
    } catch {
      setError("Errore nel salvare la sessione.");
      setIsTracking(false);
    }
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const distance = session?.distanceKm ?? 0;
  const pace = session?.currentPaceSecPerKm ?? 0;
  const pts = (session?.points as Array<{ lat: number; lon: number }> | undefined) ?? localPoints;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">Tracciamento Live</h1>

      {/* Live stats */}
      {isTracking && (
        <div className="brand-gradient rounded-2xl p-6 text-white mb-6 relative overflow-hidden">
          <div className="absolute top-4 right-4 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider opacity-80">Live</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1">Distanza</div>
              <div className="text-3xl font-black">{distance.toFixed(2)}</div>
              <div className="text-white/60 text-sm">km</div>
            </div>
            <div>
              <div className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1">Durata</div>
              <div className="text-3xl font-black">{formatDuration(localDuration)}</div>
              <div className="text-white/60 text-sm">&nbsp;</div>
            </div>
            <div>
              <div className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-1">Passo</div>
              <div className="text-3xl font-black">{formatPace(pace)}</div>
              <div className="text-white/60 text-sm">/km</div>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      {isTracking && (
        <div className="bg-white border border-border rounded-xl overflow-hidden mb-6" style={{ height: 320 }}>
          <LiveMap points={pts} currentPos={currentPos} />
        </div>
      )}

      {!isTracking && (
        <div className="bg-muted/30 rounded-2xl border border-dashed border-border p-12 text-center mb-6">
          <div className="text-5xl mb-4">📍</div>
          <p className="font-semibold text-foreground mb-1">Pronto per il tracciamento</p>
          <p className="text-sm text-muted-foreground">Premi Start per iniziare a registrare il tuo allenamento.</p>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-xl p-4 mb-6 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3">
        {!isTracking ? (
          <button
            onClick={handleStart}
            disabled={startSession.isPending}
            className="flex-1 py-4 bg-primary text-white rounded-xl font-black text-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {startSession.isPending ? "Avvio..." : "Start"}
          </button>
        ) : (
          <button
            onClick={handleStop}
            disabled={stopSession.isPending}
            className="flex-1 py-4 bg-foreground text-white rounded-xl font-black text-lg hover:bg-foreground/90 transition-colors disabled:opacity-60"
          >
            {stopSession.isPending ? "Salvataggio..." : "Stop e Salva"}
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Il tracciamento utilizza il GPS del dispositivo. Tieni la schermata aperta durante l'allenamento.
      </p>
    </div>
  );
}
