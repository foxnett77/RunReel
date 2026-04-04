import { useParams, useLocation } from "wouter";
import { useGetActivity, useDeleteActivity, getListActivitiesQueryKey, getGetStatsSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

// Lazy load Leaflet only in browser
declare global {
  interface Window {
    L: typeof import("leaflet");
  }
}

function MapView({ points }: { points: Array<{ lat: number; lon: number }> }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);

  useEffect(() => {
    if (!mapRef.current || points.length === 0) return;
    if (mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      import("leaflet/dist/leaflet.css");
      const map = L.map(mapRef.current!);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const latlngs = points.map((p) => [p.lat, p.lon] as [number, number]);
      const polyline = L.polyline(latlngs, { color: "#E11D48", weight: 4, opacity: 0.9 }).addTo(map);
      map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

      if (points.length > 0) {
        const start = points[0];
        const end = points[points.length - 1];
        const greenIcon = L.divIcon({ html: '<div style="width:12px;height:12px;border-radius:50%;background:#22c55e;border:2px solid white;"></div>', iconSize: [12, 12], className: "" });
        const redIcon = L.divIcon({ html: '<div style="width:12px;height:12px;border-radius:50%;background:#E11D48;border:2px solid white;"></div>', iconSize: [12, 12], className: "" });
        L.marker([start.lat, start.lon], { icon: greenIcon }).addTo(map);
        L.marker([end.lat, end.lon], { icon: redIcon }).addTo(map);
      }

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

function ElevationChart({ points }: { points: Array<{ ele?: number }> }) {
  const withEle = points.filter((p) => p.ele != null);
  if (withEle.length < 2) return null;

  const elevations = withEle.map((p) => p.ele!);
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const range = max - min || 1;

  const width = 400;
  const height = 80;
  const step = width / (withEle.length - 1);

  const pathPoints = withEle.map((p, i) => {
    const x = i * step;
    const y = height - ((p.ele! - min) / range) * height;
    return `${x},${y}`;
  });

  const pathD = `M${pathPoints.join(" L")} L${width},${height} L0,${height} Z`;

  return (
    <div className="bg-white border border-border rounded-xl p-4">
      <div className="text-sm font-semibold text-muted-foreground mb-3">Profilo altimetrico</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20" preserveAspectRatio="none">
        <defs>
          <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E11D48" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#E11D48" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={pathD} fill="url(#elev-grad)" />
        <polyline points={pathPoints.join(" ")} fill="none" stroke="#E11D48" strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>Min: {Math.round(min)}m</span>
        <span>Max: {Math.round(max)}m</span>
      </div>
    </div>
  );
}

export default function ActivityDetail() {
  const params = useParams();
  const id = parseInt(params.id ?? "0", 10);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const deleteActivity = useDeleteActivity();
  const [reelState, setReelState] = useState<"idle" | "recording" | "done">("idle");
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { data: activity, isLoading, error } = useGetActivity(id, {
    query: { enabled: !!id },
  });

  const handleDelete = async () => {
    if (!confirm("Eliminare questa attivita?")) return;
    await deleteActivity.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
    navigate("/activities");
  };

  const handleCreateReel = async () => {
    if (!activity || !canvasRef.current) return;
    setReelState("recording");
    setReelUrl(null);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 1080;
    const H = 1920;
    canvas.width = W;
    canvas.height = H;

    const points = (activity.points as Array<{ lat: number; lon: number }>) ?? [];
    if (points.length < 2) {
      setReelState("idle");
      return;
    }

    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const pad = 0.1;

    const toX = (lon: number) => ((lon - minLon) / ((maxLon - minLon) || 1)) * (W * (1 - pad * 2)) + W * pad;
    const toY = (lat: number) => H * 0.7 - ((lat - minLat) / ((maxLat - minLat) || 1)) * (H * 0.5);

    const chunks = Math.ceil(points.length / 4);
    const fps = 30;
    const durationMs = 8000;
    const totalFrames = Math.round((durationMs / 1000) * fps);

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp9", videoBitsPerSecond: 4000000 });
    const chunks2: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks2.push(e.data); };

    recorder.onstop = () => {
      const blob = new Blob(chunks2, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setReelUrl(url);
      setReelState("done");
    };

    recorder.start();

    let frame = 0;
    const animate = () => {
      const progress = frame / totalFrames;
      const pointsToShow = Math.max(2, Math.round(progress * points.length));

      // Background
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);

      // Grid lines
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        ctx.beginPath(); ctx.moveTo(i * W / 10, 0); ctx.lineTo(i * W / 10, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * H / 10); ctx.lineTo(W, i * H / 10); ctx.stroke();
      }

      // Track glow
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#E11D48";
      ctx.strokeStyle = "rgba(225,29,72,0.3)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = toX(points[i].lon);
        const y = toY(points[i].lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Animated track
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#E11D48";
      ctx.strokeStyle = "#E11D48";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < pointsToShow; i++) {
        const x = toX(points[i].lon);
        const y = toY(points[i].lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Current point dot
      if (pointsToShow < points.length) {
        const cur = points[pointsToShow - 1];
        const cx = toX(cur.lon);
        const cy = toY(cur.lat);
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#E11D48";
        ctx.fill();
      }

      // Title
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, H * 0.72, W, H * 0.28);

      ctx.fillStyle = "#E11D48";
      ctx.font = `bold 60px Inter, sans-serif`;
      ctx.textAlign = "left";
      ctx.fillText("RunReel", 80, H * 0.72 + 90);

      ctx.fillStyle = "white";
      ctx.font = `bold 48px Inter, sans-serif`;
      ctx.fillText(activity.name, 80, H * 0.72 + 160);

      const alpha = Math.min(1, progress * 4);
      ctx.globalAlpha = alpha;

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.roundRect(60, H * 0.72 + 200, 290, 100, 16);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `bold 42px Inter, sans-serif`;
      ctx.fillText(`${activity.distanceKm?.toFixed(2)} km`, 80, H * 0.72 + 262);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = `28px Inter, sans-serif`;
      ctx.fillText("distanza", 80, H * 0.72 + 296);

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.roundRect(380, H * 0.72 + 200, 290, 100, 16);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.font = `bold 42px Inter, sans-serif`;
      const pace = activity.avgPaceSecPerKm ?? 0;
      ctx.fillText(`${Math.floor(pace/60)}:${(pace%60).toString().padStart(2,"0")}/km`, 400, H * 0.72 + 262);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = `28px Inter, sans-serif`;
      ctx.fillText("passo", 400, H * 0.72 + 296);

      ctx.globalAlpha = 1;

      frame++;
      if (frame < totalFrames) {
        requestAnimationFrame(animate);
      } else {
        recorder.stop();
      }
    };

    requestAnimationFrame(animate);
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-4">
          <div className="h-8 w-48 bg-muted rounded animate-pulse" />
          <div className="h-72 bg-muted rounded-xl animate-pulse" />
          <div className="grid grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !activity) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <p className="text-destructive font-semibold">Attivita non trovata.</p>
      </div>
    );
  }

  const points = (activity.points as Array<{ lat: number; lon: number; ele?: number }>) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs font-bold rounded">
              {activityTypeLabel(activity.type)}
            </span>
            <span className="text-sm text-muted-foreground">{formatDate(activity.date)}</span>
          </div>
          <h1 className="text-2xl font-black">{activity.name}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateReel}
            disabled={reelState === "recording"}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {reelState === "recording" ? (
              <>
                <span className="w-3 h-3 rounded-full bg-white animate-pulse inline-block" />
                Creazione...
              </>
            ) : "Crea Reel"}
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
          >
            Elimina
          </button>
        </div>
      </div>

      {/* Reel download */}
      {reelState === "done" && reelUrl && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6 flex items-center gap-4">
          <div className="text-2xl">🎬</div>
          <div className="flex-1">
            <p className="font-semibold text-foreground">Reel pronto!</p>
            <p className="text-sm text-muted-foreground">Il tuo video e stato creato.</p>
          </div>
          <div className="flex gap-2">
            <a
              href={reelUrl}
              download={`runreel-${activity.id}.webm`}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors"
            >
              Scarica
            </a>
            {typeof navigator.share === "function" && (
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(reelUrl);
                    const blob = await response.blob();
                    const file = new File([blob], `runreel-${activity.id}.webm`, { type: "video/webm" });
                    await navigator.share({ files: [file], title: activity.name });
                  } catch { /* ignore */ }
                }}
                className="px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors"
              >
                Condividi
              </button>
            )}
          </div>
        </div>
      )}

      {/* Canvas for reel (hidden) */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Distanza", value: formatDistance(activity.distanceKm) },
          { label: "Durata", value: formatDuration(activity.durationSecs) },
          { label: "Passo medio", value: formatPace(activity.avgPaceSecPerKm ?? 0) + "/km" },
          { label: "Dislivello", value: `${Math.round(activity.elevationGainM ?? 0)}m` },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-border rounded-xl p-4">
            <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">{s.label}</div>
            <div className="text-xl font-black text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Map */}
      {points.length > 0 && (
        <div className="bg-white border border-border rounded-xl overflow-hidden mb-6" style={{ height: 400 }}>
          <MapView points={points} />
        </div>
      )}

      {/* Elevation */}
      <ElevationChart points={points} />
    </div>
  );
}
