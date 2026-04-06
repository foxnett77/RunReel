import { useParams, useLocation } from "wouter";
import { useGetActivity, useDeleteActivity, getListActivitiesQueryKey, getGetStatsSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import AnimatedMap3D, { type AnimatedMap3DHandle } from "@/components/AnimatedMap3D";

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
  const map3dRef = useRef<AnimatedMap3DHandle>(null);

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

  const reelMimeType = MediaRecorder.isTypeSupported("video/mp4")
    ? "video/mp4"
    : "video/webm; codecs=vp9";
  const reelExtension = reelMimeType.startsWith("video/mp4") ? "mp4" : "webm";

  const handleCreateReel = () => {
    if (!activity) return;
    const points = (activity.points as Array<{ lat: number; lon: number }>) ?? [];
    if (points.length < 2) return;

    setReelState("recording");
    setReelUrl(null);

    const W = 1080, H = 1920;
    const MAP_H = Math.round(H * 0.72);  // 1382px — mappa
    const STATS_Y = MAP_H;
    const fps = 30;
    const DURATION_MS = 12000;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * fps);

    // ── Pre-computazione coordinate ──────────────────────────────────────────
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const routeW = maxLon - minLon || 0.001;
    const routeH = maxLat - minLat || 0.001;

    // Mantieni aspect ratio del percorso e aggiunge padding
    const PAD = 0.12;
    const scaleX = (W * (1 - PAD * 2)) / routeW;
    const scaleY = (MAP_H * (1 - PAD * 2)) / routeH;
    const scale = Math.min(scaleX, scaleY);
    const offX = (W - routeW * scale) / 2;
    const offY = MAP_H - (MAP_H - routeH * scale) / 2;

    const toX = (lon: number) => offX + (lon - minLon) * scale;
    const toY = (lat: number) => offY - (lat - minLat) * scale;

    // Pre-calcola coords screenspace
    const coords = points.map(p => ({ x: toX(p.lon), y: toY(p.lat) }));

    // ── Canvas 2D su elemento nascosto nel DOM ───────────────────────────────
    const canvas = canvasRef.current!;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // ── MediaRecorder ────────────────────────────────────────────────────────
    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: reelMimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: reelMimeType.split(";")[0] });
      setReelUrl(URL.createObjectURL(blob));
      setReelState("done");
    };
    recorder.start();

    // ── Helpers UI ───────────────────────────────────────────────────────────
    const drawBg = () => {
      // Gradiente scuro stile mappa notturna
      const grad = ctx.createLinearGradient(0, 0, 0, MAP_H);
      grad.addColorStop(0, "#0d1117");
      grad.addColorStop(1, "#111827");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, MAP_H);
      // Griglia tenue
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath(); ctx.moveTo(i * W / 10, 0); ctx.lineTo(i * W / 10, MAP_H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * MAP_H / 10); ctx.lineTo(W, i * MAP_H / 10); ctx.stroke();
      }
    };

    const drawGhostRoute = () => {
      ctx.save();
      ctx.strokeStyle = "rgba(225,29,72,0.28)";
      ctx.lineWidth = 9;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      coords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();
    };

    const drawProgressRoute = (upTo: number) => {
      if (upTo < 2) return;
      // Strato 1: glow esterno
      ctx.save();
      ctx.shadowBlur = 40;
      ctx.shadowColor = "#E11D48";
      ctx.strokeStyle = "rgba(225,29,72,0.5)";
      ctx.lineWidth = 22;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < upTo; i++) { i === 0 ? ctx.moveTo(coords[i].x, coords[i].y) : ctx.lineTo(coords[i].x, coords[i].y); }
      ctx.stroke();
      ctx.restore();

      // Strato 2: traccia principale
      ctx.save();
      ctx.shadowBlur = 18;
      ctx.shadowColor = "#E11D48";
      ctx.strokeStyle = "#E11D48";
      ctx.lineWidth = 12;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < upTo; i++) { i === 0 ? ctx.moveTo(coords[i].x, coords[i].y) : ctx.lineTo(coords[i].x, coords[i].y); }
      ctx.stroke();
      ctx.restore();

      // Strato 3: highlight bianco centrale
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < upTo; i++) { i === 0 ? ctx.moveTo(coords[i].x, coords[i].y) : ctx.lineTo(coords[i].x, coords[i].y); }
      ctx.stroke();
      ctx.restore();
    };

    const drawRunner = (frame: number, upTo: number) => {
      if (upTo < 1 || upTo >= coords.length) return;
      const { x, y } = coords[upTo - 1];
      // Anello pulse (espande e sfuma)
      const pulseT = (frame % 20) / 20;
      ctx.save();
      ctx.globalAlpha = (1 - pulseT) * 0.6;
      ctx.beginPath();
      ctx.arc(x, y, 22 + pulseT * 30, 0, Math.PI * 2);
      ctx.strokeStyle = "#E11D48";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      // Cerchio bianco esterno
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "white";
      ctx.fill();
      ctx.restore();
      // Punto rosso interno
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fillStyle = "#E11D48";
      ctx.fill();
      ctx.restore();
    };

    const drawStats = (progress: number) => {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, STATS_Y, W, H - STATS_Y);

      // Separatore
      ctx.fillStyle = "#E11D48";
      ctx.fillRect(0, STATS_Y, W, 4);

      ctx.textAlign = "left";
      ctx.fillStyle = "#E11D48";
      ctx.font = "bold 72px Inter,system-ui,sans-serif";
      ctx.fillText("RunReel", 80, STATS_Y + 106);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 50px Inter,system-ui,sans-serif";
      const name = activity.name.length > 26 ? activity.name.slice(0, 25) + "…" : activity.name;
      ctx.fillText(name, 80, STATS_Y + 178);

      const alpha = Math.min(1, progress * 4);
      ctx.globalAlpha = alpha;

      const drawCard = (x: number, y: number, cw: number, ch: number, big: string, small: string) => {
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.roundRect(x, y, cw, ch, 16);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 46px Inter,system-ui,sans-serif";
        ctx.fillText(big, x + 24, y + 66);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = "30px Inter,system-ui,sans-serif";
        ctx.fillText(small, x + 24, y + 104);
      };

      const pace = activity.avgPaceSecPerKm ?? 0;
      const dur = activity.durationSecs ?? 0;
      drawCard(60, STATS_Y + 210, 455, 120, `${activity.distanceKm?.toFixed(2)} km`, "distanza");
      drawCard(565, STATS_Y + 210, 455, 120, `${Math.floor(pace / 60)}:${(pace % 60).toString().padStart(2, "0")}/km`, "passo");
      drawCard(60, STATS_Y + 350, 455, 120, `${Math.floor(dur / 3600)}h ${Math.floor((dur % 3600) / 60)}'`, "durata");
      drawCard(565, STATS_Y + 350, 455, 120, `+${Math.round(activity.elevationGainM ?? 0)} m`, "dislivello");

      // Barra progresso in basso
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.roundRect(60, STATS_Y + 500, W - 120, 10, 5);
      ctx.fill();
      ctx.fillStyle = "#E11D48";
      ctx.beginPath();
      ctx.roundRect(60, STATS_Y + 500, (W - 120) * progress, 10, 5);
      ctx.fill();
    };

    // ── Loop di animazione ───────────────────────────────────────────────────
    let frame = 0;
    // Easing: accelera lentamente all'inizio, rallenta alla fine
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const animate = () => {
      const rawT = frame / TOTAL_FRAMES;
      const progress = ease(rawT);
      const upTo = Math.max(2, Math.round(progress * (coords.length - 1)) + 1);

      drawBg();
      drawGhostRoute();
      drawProgressRoute(upTo);
      drawRunner(frame, upTo);
      drawStats(rawT);

      frame++;
      if (frame < TOTAL_FRAMES) requestAnimationFrame(animate);
      else recorder.stop();
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
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-4 mb-3">
            <div className="text-2xl">🎬</div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">Reel pronto!</p>
              <p className="text-sm text-muted-foreground">Il tuo video è stato creato.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {typeof navigator.share === "function" && (
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(reelUrl);
                    const blob = await response.blob();
                    const mimeBase = reelMimeType.split(";")[0];
                    const file = new File([blob], `runreel-${activity.id}.${reelExtension}`, { type: mimeBase });
                    await navigator.share({ files: [file], title: activity.name });
                  } catch { /* ignore */ }
                }}
                className="flex-1 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v13M8 7l4-5 4 5"/>
                  <path d="M20 21H4"/>
                </svg>
                Salva in Foto
              </button>
            )}
            <a
              href={reelUrl}
              download={`runreel-${activity.id}.${reelExtension}`}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v13M8 11l4 4 4-4"/>
                <path d="M20 21H4"/>
              </svg>
              Scarica
            </a>
          </div>
          {reelExtension === "mp4" && (
            <p className="text-xs text-muted-foreground mt-2.5">
              Tocca <strong>Salva in Foto</strong> → il sistema ti chiederà dove salvarlo → scegli <strong>Foto</strong> per aggiungerlo alla libreria.
            </p>
          )}
          {reelExtension === "webm" && (
            <p className="text-xs text-muted-foreground mt-2.5">
              Su Android tocca <strong>Salva in Foto</strong> per salvarlo direttamente nella galleria.
            </p>
          )}
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

      {/* 3D Animated Map */}
      {points.length > 1 && (
        <div className="mb-6">
          <AnimatedMap3D
            ref={map3dRef}
            points={points}
            distanceKm={activity.distanceKm ?? 0}
            elevationGainM={activity.elevationGainM ?? 0}
            durationSecs={activity.durationSecs ?? 0}
            avgPaceSecPerKm={activity.avgPaceSecPerKm ?? 0}
          />
        </div>
      )}

      {/* Elevation */}
      <ElevationChart points={points} />
    </div>
  );
}
