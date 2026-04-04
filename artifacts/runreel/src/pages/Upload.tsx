import { useState, useRef, useCallback } from "react";
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
  const date = points[0]?.time ? points[0].time.split("T")[0] : new Date().toISOString().split("T")[0];

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
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const xml = e.target?.result as string;
        const p = parseGpx(xml);
        setParsed(p);
        setCustomName(p.name);
      } catch {
        setError("Impossibile analizzare il file GPX. Verifica che sia un file valido.");
      }
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

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

  const { formatDistance, formatDuration, formatPace } = {
    formatDistance: (km: number) => `${km.toFixed(2)} km`,
    formatDuration: (secs: number) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    },
    formatPace: (secPerKm: number) => {
      if (!secPerKm) return "--:--";
      return `${Math.floor(secPerKm / 60)}:${(secPerKm % 60).toString().padStart(2, "0")}`;
    },
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-black mb-6">Carica un file GPX</h1>

      {!parsed ? (
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".gpx"
            className="hidden"
            onChange={onFileInput}
          />
          <div className="text-5xl mb-4">📁</div>
          <p className="font-bold text-foreground mb-1">Trascina qui il tuo file GPX</p>
          <p className="text-sm text-muted-foreground">oppure clicca per selezionare un file</p>
          {error && (
            <p className="mt-4 text-sm text-destructive font-medium">{error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-4">
            <div className="text-3xl">✅</div>
            <div>
              <p className="font-semibold text-foreground">File GPX analizzato</p>
              <p className="text-sm text-muted-foreground">{parsed.points.length} punti GPS trovati</p>
            </div>
          </div>

          {/* Stats preview */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-xl font-black text-foreground">{formatDistance(parsed.distanceKm)}</div>
              <div className="text-xs text-muted-foreground mt-1">Distanza</div>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-xl font-black text-foreground">{formatDuration(parsed.durationSecs)}</div>
              <div className="text-xs text-muted-foreground mt-1">Durata</div>
            </div>
            <div className="bg-white border border-border rounded-xl p-4 text-center">
              <div className="text-xl font-black text-foreground">{formatPace(parsed.avgPaceSecPerKm)}/km</div>
              <div className="text-xs text-muted-foreground mt-1">Passo medio</div>
            </div>
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-1.5">Nome attivita</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full px-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
              disabled={saving}
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
