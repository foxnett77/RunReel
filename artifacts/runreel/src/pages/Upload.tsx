import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useCreateActivity } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListActivitiesQueryKey, getGetStatsSummaryQueryKey } from "@workspace/api-client-react";

interface TrackPoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

interface ParsedActivity {
  name: string;
  date: string;
  distanceKm: number;
  durationSecs: number;
  elevationGainM: number;
  avgPaceSecPerKm: number;
  maxSpeedKmh: number;
  points: TrackPoint[];
}

function haversineKm(p1: TrackPoint, p2: TrackPoint): number {
  const R = 6371;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGpx(xml: string): ParsedActivity {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const trkpts = Array.from(doc.querySelectorAll("trkpt"));

  if (trkpts.length === 0) {
    throw new Error("Nessun punto GPS trovato nel file.");
  }

  const points: TrackPoint[] = trkpts.map((pt) => ({
    lat: parseFloat(pt.getAttribute("lat") ?? "0"),
    lon: parseFloat(pt.getAttribute("lon") ?? "0"),
    ele: pt.querySelector("ele") ? parseFloat(pt.querySelector("ele")!.textContent ?? "0") : undefined,
    time: pt.querySelector("time")?.textContent ?? undefined,
  }));

  let distanceKm = 0;
  for (let i = 1; i < points.length; i++) {
    distanceKm += haversineKm(points[i - 1], points[i]);
  }

  let elevationGainM = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    if (diff > 0) elevationGainM += diff;
  }

  let durationSecs = 0;
  if (points.length >= 2 && points[0].time && points[points.length - 1].time) {
    const start = new Date(points[0].time).getTime();
    const end = new Date(points[points.length - 1].time).getTime();
    durationSecs = Math.round((end - start) / 1000);
  }

  const avgPaceSecPerKm = distanceKm > 0 ? Math.round(durationSecs / distanceKm) : 0;

  const nameEl = doc.querySelector("trk > name");
  const name = nameEl?.textContent?.trim() || "Attivita GPX";
  const date = points[0]?.time
    ? points[0].time.split("T")[0]
    : new Date().toISOString().split("T")[0];

  return {
    name,
    date,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationSecs,
    elevationGainM: Math.round(elevationGainM),
    avgPaceSecPerKm,
    maxSpeedKmh: 0,
    points,
  };
}

function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return "0:00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
function formatPace(secPerKm: number): string {
  if (!secPerKm) return "--:--";
  return `${Math.floor(secPerKm / 60)}:${(secPerKm % 60).toString().padStart(2, "0")}`;
}

// Map preview component using Leaflet
function PreviewMap({ points }: { points: TrackPoint[] }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;

    // Destroy any existing instance
    if (mapInstanceRef.current) {
      (mapInstanceRef.current as { remove(): void }).remove();
      mapInstanceRef.current = null;
    }

    import("leaflet").then((L) => {
      if (!mapRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);

      // Full track (faded)
      L.polyline(latlngs, {
        color: "#E11D48",
        weight: 4,
        opacity: 0.85,
        lineJoin: "round",
      }).addTo(map);

      // Fit map to track bounds
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds, { padding: [30, 30] });

      // Start marker (green dot)
      const startIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        className: "",
      });
      // End marker (red dot)
      const endIcon = L.divIcon({
        html: `<div style="width:14px;height:14px;border-radius:50%;background:#E11D48;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        className: "",
      });

      L.marker([points[0].lat, points[0].lon], { icon: startIcon })
        .bindTooltip("Inizio", { permanent: false })
        .addTo(map);
      L.marker([points[points.length - 1].lat, points[points.length - 1].lon], { icon: endIcon })
        .bindTooltip("Fine", { permanent: false })
        .addTo(map);

      mapInstanceRef.current = map;
    });

    return () => {
      if (mapInstanceRef.current) {
        (mapInstanceRef.current as { remove(): void }).remove();
        mapInstanceRef.current = null;
      }
    };
  }, [points]);

  return <div ref={mapRef} className="w-full h-full" />;
}

// Simple SVG elevation chart
function ElevationPreview({ points }: { points: TrackPoint[] }) {
  const withEle = points.filter((p) => p.ele != null);
  if (withEle.length < 2) return null;

  const elevations = withEle.map((p) => p.ele!);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = max - min || 1;

  const W = 400;
  const H = 60;
  const step = W / (withEle.length - 1);

  const pathPoints = withEle.map((p, i) => {
    const x = i * step;
    const y = H - ((p.ele! - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPath = `M${pathPoints.join(" L")} L${W},${H} L0,${H} Z`;

  return (
    <div className="mt-2">
      <div className="text-xs font-semibold text-muted-foreground mb-1">Profilo altimetrico</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
        <defs>
          <linearGradient id="elev-grad-upload" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E11D48" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#E11D48" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#elev-grad-upload)" />
        <polyline
          points={pathPoints.join(" ")}
          fill="none"
          stroke="#E11D48"
          strokeWidth="1.5"
        />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Min: {Math.round(min)} m</span>
        <span>Max: {Math.round(max)} m</span>
        <span>Dislivello: +{Math.round(max - min)} m</span>
      </div>
    </div>
  );
}

export default function Upload() {
  const [, navigate] = useLocation();
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedActivity | null>(null);
  const [activityType, setActivityType] = useState<"run" | "walk" | "bike" | "hike" | "other">("run");
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const createActivity = useCreateActivity();
  const queryClient = useQueryClient();

  const handleFile = useCallback((file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setError("Il file deve essere in formato GPX (.gpx).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xml = e.target?.result as string;
        const p = parseGpx(xml);
        setParsed(p);
        setCustomName(p.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Impossibile analizzare il file GPX.");
      }
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleSave = async () => {
    if (!parsed) return;
    setSaving(true);
    try {
      const result = await createActivity.mutateAsync({
        data: {
          name: customName || parsed.name,
          date: parsed.date,
          distanceKm: parsed.distanceKm,
          durationSecs: parsed.durationSecs,
          elevationGainM: parsed.elevationGainM,
          avgPaceSecPerKm: parsed.avgPaceSecPerKm,
          maxSpeedKmh: parsed.maxSpeedKmh,
          type: activityType,
          points: parsed.points,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
      navigate(`/activities/${result.id}`);
    } catch {
      setError("Errore durante il salvataggio. Riprova.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">Carica un file GPX</h1>

      {!parsed ? (
        /* ── Drop zone ── */
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer select-none ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".gpx,application/gpx+xml"
            className="hidden"
            onChange={onFileInput}
          />
          <div className="text-6xl mb-4 select-none">
            {dragging ? "📂" : "📁"}
          </div>
          <p className="font-bold text-foreground mb-1">
            {dragging ? "Rilascia il file qui" : "Trascina qui il tuo file GPX"}
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            oppure clicca per selezionare un file
          </p>
          <span className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Scegli file .gpx
          </span>
          {error && (
            <p className="mt-4 text-sm text-destructive font-medium">{error}</p>
          )}
        </div>
      ) : (
        /* ── Preview + form ── */
        <div className="space-y-5">
          {/* Success badge */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xl flex-shrink-0">✅</div>
            <div>
              <p className="font-semibold text-foreground">File GPX caricato</p>
              <p className="text-sm text-muted-foreground">{parsed.points.length.toLocaleString("it-IT")} punti GPS trovati</p>
            </div>
            <button
              onClick={() => { setParsed(null); setError(null); }}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1"
              title="Carica un altro file"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Map preview */}
          <div className="bg-white border border-border rounded-xl overflow-hidden" style={{ height: 340 }}>
            <PreviewMap points={parsed.points} />
          </div>

          {/* Elevation chart */}
          <div className="bg-white border border-border rounded-xl p-4">
            <ElevationPreview points={parsed.points} />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Distanza", value: `${parsed.distanceKm.toFixed(2)} km` },
              { label: "Durata", value: formatDuration(parsed.durationSecs) },
              { label: "Passo medio", value: formatPace(parsed.avgPaceSecPerKm) + "/km" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-border rounded-xl p-4 text-center">
                <div className="text-lg font-black text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Nome attivita</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Es. Corsa mattutina al parco"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1.5">Tipo di attivita</label>
              <div className="flex gap-2 flex-wrap">
                {(["run", "walk", "bike", "hike", "other"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActivityType(t)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      activityType === t
                        ? "bg-primary text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {t === "run" ? "Corsa" : t === "walk" ? "Camminata" : t === "bike" ? "Bicicletta" : t === "hike" ? "Escursione" : "Altro"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive font-medium">{error}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setParsed(null); setError(null); }}
              className="flex-1 px-4 py-3 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
            >
              Cancella
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !customName.trim()}
              className="flex-1 px-4 py-3 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? "Salvataggio..." : "Salva attivita"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
