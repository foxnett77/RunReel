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

  const handleCreateReel = async () => {
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

    // ── Coordinate bounds ────────────────────────────────────────────────────
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);

    // ── Tile math (Web Mercator) ─────────────────────────────────────────────
    const lon2t = (lon: number, z: number) => (lon + 180) / 360 * Math.pow(2, z);
    const lat2t = (lat: number, z: number) => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
    };

    // Trova il miglior zoom: route che occupa 4-7 tile per asse
    let zoom = 12;
    for (let z = 16; z >= 8; z--) {
      if (lon2t(maxLon, z) - lon2t(minLon, z) <= 7 &&
          lat2t(minLat, z) - lat2t(maxLat, z) <= 7) { zoom = z; break; }
    }

    // Viewport in tile-space con 0.8 tile di padding
    const PAD_T = 0.9;
    const tx0 = lon2t(minLon, zoom) - PAD_T, tx1 = lon2t(maxLon, zoom) + PAD_T;
    const ty0 = lat2t(maxLat, zoom) - PAD_T, ty1 = lat2t(minLat, zoom) + PAD_T;

    // Scala per fare entrare il viewport nel canvas mantenendo aspect ratio
    const TILE_PX = 256;
    const vpW = (tx1 - tx0) * TILE_PX, vpH = (ty1 - ty0) * TILE_PX;
    const tileScale = Math.min(W / vpW, MAP_H / vpH);
    const mapOffX = (W - vpW * tileScale) / 2;
    const mapOffY = (MAP_H - vpH * tileScale) / 2;

    const toCanvasX = (lon: number) => mapOffX + (lon2t(lon, zoom) - tx0) * TILE_PX * tileScale;
    const toCanvasY = (lat: number) => mapOffY + (lat2t(lat, zoom) - ty0) * TILE_PX * tileScale;
    const coords = points.map(p => ({ x: toCanvasX(p.lon), y: toCanvasY(p.lat) }));

    // ── Precarica tile (CartoCDN Dark, CORS-enabled) ─────────────────────────
    type TileImg = { img: HTMLImageElement; dx: number; dy: number; dw: number; dh: number };
    const tileImages: TileImg[] = [];
    const ixMin = Math.floor(tx0), ixMax = Math.ceil(tx1);
    const iyMin = Math.floor(ty0), iyMax = Math.ceil(ty1);
    const maxTileIdx = Math.pow(2, zoom);

    const tilePromises: Promise<void>[] = [];
    for (let iy = iyMin; iy <= iyMax; iy++) {
      for (let ix = ixMin; ix <= ixMax; ix++) {
        if (ix < 0 || iy < 0 || ix >= maxTileIdx || iy >= maxTileIdx) continue;
        const dx = mapOffX + (ix - tx0) * TILE_PX * tileScale;
        const dy = mapOffY + (iy - ty0) * TILE_PX * tileScale;
        const dw = TILE_PX * tileScale, dh = TILE_PX * tileScale;
        tilePromises.push(new Promise<void>(resolve => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { tileImages.push({ img, dx, dy, dw, dh }); resolve(); };
          img.onerror = () => resolve();
          img.src = `https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/${zoom}/${ix}/${iy}.png`;
        }));
      }
    }
    // Attendi le tile con timeout di 5s (poi si procede con quelle caricate)
    await Promise.race([
      Promise.allSettled(tilePromises),
      new Promise(r => setTimeout(r, 5000)),
    ]);

    // ── Canvas setup ─────────────────────────────────────────────────────────
    const canvas = canvasRef.current!;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // ── Musica sintetizzata via Web Audio (prima del recorder) ───────────────
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    try {
      const audioCtx = new AudioContext();
      audioDest = audioCtx.createMediaStreamDestination();
      const bpm = 130, beatSec = 60 / bpm;
      const totalBeats = Math.ceil(DURATION_MS / 1000 / beatSec) + 4;
      const t0 = audioCtx.currentTime + 0.08;

      const kick = (t: number) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(audioDest!);
        o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(0.01, t + 0.45);
        g.gain.setValueAtTime(1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.start(t); o.stop(t + 0.5);
      };
      const snare = (t: number) => {
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.12), audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.2);
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const f = audioCtx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2800; f.Q.value = 0.7;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        src.connect(f); f.connect(g); g.connect(audioDest!); src.start(t);
      };
      const hihat = (t: number, vol: number) => {
        const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.04), audioCtx.sampleRate);
        const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const f = audioCtx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 9000;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.connect(f); f.connect(g); g.connect(audioDest!); src.start(t);
      };
      const synth = (t: number, freq: number) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sawtooth"; o.frequency.value = freq;
        const f = audioCtx.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.25);
        o.connect(f); f.connect(g); g.connect(audioDest!);
        g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        o.start(t); o.stop(t + 0.3);
      };
      const bassline = [220, 220, 165, 196, 220, 246, 220, 196];
      for (let b = 0; b < totalBeats; b++) {
        const t = t0 + b * beatSec;
        const inBar = b % 4;
        if (inBar === 0 || inBar === 2) kick(t);
        if (inBar === 1 || inBar === 3) snare(t);
        hihat(t, 0.3); hihat(t + beatSec * 0.5, 0.18);
        synth(t, bassline[b % bassline.length]);
      }
    } catch { /* audio non supportato */ }

    // ── MediaRecorder (video + audio opzionale) ───────────────────────────────
    const videoStream = canvas.captureStream(fps);
    const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
    if (audioDest) tracks.push(...audioDest.stream.getAudioTracks());
    const combinedStream = new MediaStream(tracks);
    const recorder = new MediaRecorder(combinedStream, { mimeType: reelMimeType, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: reelMimeType.split(";")[0] });
      setReelUrl(URL.createObjectURL(blob));
      setReelState("done");
    };
    recorder.start();

    // ── Generatore di fulmini ─────────────────────────────────────────────────
    type Bolt = { segs: { x: number; y: number }[]; branch: { x: number; y: number }[]; life: number; maxLife: number };
    const activeBolts: Bolt[] = [];
    let nextBoltIn = Math.floor(Math.random() * 35 + 15);

    const makeBolt = (fromX: number, fromY: number): Bolt => {
      const segs: { x: number; y: number }[] = [{ x: fromX, y: fromY }];
      let cx = fromX, cy = fromY;
      for (let s = 0; s < 7 + Math.floor(Math.random() * 5); s++) {
        cx += (Math.random() - 0.45) * 120; cy += 55 + Math.random() * 75;
        segs.push({ x: cx, y: cy });
      }
      const mid = Math.floor(segs.length / 2);
      const branch: { x: number; y: number }[] = [segs[mid]];
      let bx = segs[mid].x, by = segs[mid].y;
      for (let s = 0; s < 4; s++) { bx += (Math.random() - 0.5) * 90; by += 45 + Math.random() * 55; branch.push({ x: bx, y: by }); }
      return { segs, branch, life: 8 + Math.floor(Math.random() * 5), maxLife: 8 + Math.floor(Math.random() * 5) };
    };

    // ── Draw helpers ─────────────────────────────────────────────────────────
    const drawMapBg = () => {
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, 0, W, MAP_H);
      for (const t of tileImages) ctx.drawImage(t.img, t.dx, t.dy, t.dw, t.dh);
      const vg = ctx.createRadialGradient(W / 2, MAP_H / 2, MAP_H * 0.35, W / 2, MAP_H / 2, MAP_H * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, MAP_H);
    };

    // Pattern: puntini fine stile tessuto sportivo
    const drawPattern = () => {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = "#000000";
      for (let y = 6; y < MAP_H; y += 14) {
        for (let x = (Math.floor(y / 14) % 2 === 0 ? 6 : 13); x < W; x += 20) {
          ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    };

    const pathSegs = (segs: { x: number; y: number }[]) => {
      ctx.beginPath(); segs.forEach((s, i) => i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y));
    };

    const drawBolts = () => {
      nextBoltIn--;
      if (nextBoltIn <= 0) {
        const bx = 120 + Math.random() * (W - 240);
        activeBolts.push(makeBolt(bx, 20 + Math.random() * MAP_H * 0.18));
        if (Math.random() > 0.55) activeBolts.push(makeBolt(bx + (Math.random() - 0.5) * 220, 20 + Math.random() * MAP_H * 0.15));
        nextBoltIn = Math.floor(Math.random() * 50 + 20);
      }

      for (let i = activeBolts.length - 1; i >= 0; i--) {
        const b = activeBolts[i];
        const a = b.life / b.maxLife;

        // Flash schermo intero al primo frame
        if (b.life === b.maxLife) {
          ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = "#fffde7";
          ctx.fillRect(0, 0, W, MAP_H); ctx.restore();
        }

        // Alone scuro esterno (visibile su mappa chiara)
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(10,10,40,0.85)"; ctx.lineWidth = 9;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        pathSegs(b.segs); ctx.stroke();
        ctx.restore();

        // Fulmine giallo-bianco principale
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowBlur = 30; ctx.shadowColor = "#ffe57f";
        ctx.strokeStyle = "#FFEB3B"; ctx.lineWidth = 4;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        pathSegs(b.segs); ctx.stroke();
        ctx.restore();

        // Core bianco brillante
        ctx.save();
        ctx.globalAlpha = a * 0.9;
        ctx.shadowBlur = 10; ctx.shadowColor = "white";
        ctx.strokeStyle = "white"; ctx.lineWidth = 1.5;
        pathSegs(b.segs); ctx.stroke();
        ctx.restore();

        // Ramo secondario
        ctx.save();
        ctx.globalAlpha = a * 0.7;
        ctx.shadowBlur = 16; ctx.shadowColor = "#ffe57f";
        ctx.strokeStyle = "#FFEB3B"; ctx.lineWidth = 2.5;
        pathSegs(b.branch); ctx.stroke();
        ctx.restore();

        b.life--;
        if (b.life <= 0) activeBolts.splice(i, 1);
      }
    };

    const drawGhost = () => {
      ctx.save();
      ctx.strokeStyle = "rgba(225,29,72,0.38)";
      ctx.lineWidth = 8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      coords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();
    };

    const drawProgress = (upTo: number) => {
      if (upTo < 2) return;
      const sub = coords.slice(0, upTo);
      const stroke = (width: number, color: string, blur: number) => {
        ctx.save();
        ctx.shadowBlur = blur; ctx.shadowColor = "#E11D48";
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.beginPath();
        sub.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
        ctx.stroke();
        ctx.restore();
      };
      stroke(28, "rgba(225,29,72,0.35)", 50);
      stroke(14, "#E11D48", 22);
      stroke(4, "rgba(255,255,255,0.65)", 0);
    };

    const drawRunner = (frameN: number, upTo: number) => {
      if (upTo < 1 || upTo >= coords.length) return;
      const { x, y } = coords[upTo - 1];
      const pt = (frameN % 24) / 24;
      ctx.save();
      ctx.globalAlpha = (1 - pt) * 0.55;
      ctx.beginPath(); ctx.arc(x, y, 20 + pt * 32, 0, Math.PI * 2);
      ctx.strokeStyle = "#E11D48"; ctx.lineWidth = 3; ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = "white"; ctx.shadowBlur = 12; ctx.shadowColor = "white"; ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = "#E11D48"; ctx.fill();
      ctx.restore();
    };

    const drawStats = (rawT: number) => {
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, STATS_Y, W, H - STATS_Y);
      ctx.fillStyle = "#E11D48";
      ctx.fillRect(0, STATS_Y, W, 4);

      ctx.textAlign = "left";
      ctx.fillStyle = "#E11D48";
      ctx.font = "bold 72px Inter,system-ui,sans-serif";
      ctx.fillText("RunReel", 80, STATS_Y + 108);

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 50px Inter,system-ui,sans-serif";
      const name = activity.name.length > 26 ? activity.name.slice(0, 25) + "…" : activity.name;
      ctx.fillText(name, 80, STATS_Y + 180);

      ctx.globalAlpha = Math.min(1, rawT * 4);
      const card = (x: number, y: number, cw: number, ch: number, big: string, small: string) => {
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 16); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 46px Inter,system-ui,sans-serif";
        ctx.fillText(big, x + 24, y + 66);
        ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = "30px Inter,system-ui,sans-serif";
        ctx.fillText(small, x + 24, y + 104);
      };
      const pace = activity.avgPaceSecPerKm ?? 0;
      const dur = activity.durationSecs ?? 0;
      card(60, STATS_Y + 210, 455, 120, `${activity.distanceKm?.toFixed(2)} km`, "distanza");
      card(565, STATS_Y + 210, 455, 120, `${Math.floor(pace/60)}:${(pace%60).toString().padStart(2,"0")}/km`, "passo");
      card(60, STATS_Y + 350, 455, 120, `${Math.floor(dur/3600)}h ${Math.floor((dur%3600)/60)}'`, "durata");
      card(565, STATS_Y + 350, 455, 120, `+${Math.round(activity.elevationGainM ?? 0)} m`, "dislivello");
      ctx.globalAlpha = 1;
      // Barra progresso
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.roundRect(60, STATS_Y + 500, W - 120, 10, 5); ctx.fill();
      ctx.fillStyle = "#E11D48";
      ctx.beginPath(); ctx.roundRect(60, STATS_Y + 500, (W - 120) * rawT, 10, 5); ctx.fill();
    };

    // ── Animation loop ───────────────────────────────────────────────────────
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    let frame = 0;

    const animate = () => {
      const rawT = frame / TOTAL_FRAMES;
      const upTo = Math.max(2, Math.round(ease(rawT) * (coords.length - 1)) + 1);
      drawMapBg();
      drawPattern();
      drawBolts();
      drawGhost();
      drawProgress(upTo);
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
            onClick={() => handleCreateReel().catch(() => setReelState("idle"))}
            disabled={reelState === "recording"}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {reelState === "recording" ? (
              <>
                <span className="w-3 h-3 rounded-full bg-white animate-pulse inline-block" />
                Registrazione…
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
