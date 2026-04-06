import { useParams, useLocation } from "wouter";
import { useGetActivity, useDeleteActivity, getListActivitiesQueryKey, getGetStatsSummaryQueryKey, getGetActivityQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";
import { useEffect, useRef, useState, useCallback } from "react";
import AnimatedMap3D, { type AnimatedMap3DHandle } from "@/components/AnimatedMap3D";
import { useLang } from "@/lib/i18n";

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

function ElevationChart({ points }: { points: Array<{ lat: number; lon: number; ele?: number }> }) {
  const withEle = (points.filter((p) => p.ele != null && p.lat != null && p.lon != null)) as Array<{ lat: number; lon: number; ele: number }>;
  if (withEle.length < 2) return null;

  const toRad = (d: number) => d * Math.PI / 180;
  const haversine = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  };
  const cumDist: number[] = [0];
  for (let i = 1; i < withEle.length; i++) cumDist.push(cumDist[i - 1] + haversine(withEle[i - 1], withEle[i]));
  const totalDistM = cumDist[cumDist.length - 1];
  const totalDistKm = totalDistM / 1000;

  const elevations = withEle.map((p) => p.ele);
  const minEle = Math.min(...elevations), maxEle = Math.max(...elevations);
  const rangeEle = maxEle - minEle || 1;

  let gain = 0, loss = 0;
  for (let i = 1; i < elevations.length; i++) {
    const d = elevations[i] - elevations[i - 1];
    if (d > 0) gain += d; else loss += Math.abs(d);
  }

  const W = 400, H = 100;
  const pts = withEle.map((p, i) => ({
    x: (cumDist[i] / totalDistM) * W,
    y: H - ((p.ele - minEle) / rangeEle) * (H - 4),
  }));
  const fillD = `M${pts.map(p => `${p.x},${p.y}`).join(" L")} L${W},${H} L0,${H} Z`;
  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetDist = ratio * totalDistM;
    let best = 0;
    for (let i = 1; i < cumDist.length; i++) {
      if (Math.abs(cumDist[i] - targetDist) < Math.abs(cumDist[best] - targetDist)) best = i;
    }
    setHoverIdx(best);
  }, [cumDist, totalDistM]);

  const hp = hoverIdx != null ? pts[hoverIdx] : null;
  const hpRatio = hoverIdx != null ? cumDist[hoverIdx] / totalDistM : null;

  return (
    <div className="bg-white border border-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-muted-foreground">Profilo altimetrico</div>
        <div className="flex gap-3 text-xs font-semibold">
          <span className="text-emerald-600">↑ {Math.round(gain)}m</span>
          <span className="text-rose-500">↓ {Math.round(loss)}m</span>
          <span className="text-muted-foreground">{Math.round(minEle)}–{Math.round(maxEle)}m</span>
        </div>
      </div>
      <div className="relative pt-8">
        {hp && hpRatio != null && (
          <div
            className="absolute top-0 bg-foreground text-background rounded-md px-2 py-0.5 text-xs font-semibold pointer-events-none whitespace-nowrap shadow z-10"
            style={{ left: `${hpRatio * 100}%`, transform: "translateX(-50%)" }}
          >
            {(cumDist[hoverIdx!] / 1000).toFixed(2)} km · {Math.round(withEle[hoverIdx!].ele)}m
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-28 cursor-crosshair"
          preserveAspectRatio="none"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E11D48" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#E11D48" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={fillD} fill="url(#elev-grad)" />
          <path d={lineD} fill="none" stroke="#E11D48" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <>
              <line x1={hp.x} y1={0} x2={hp.x} y2={H} stroke="#E11D48" strokeWidth="1" strokeDasharray="4,3" opacity="0.55" />
              <circle cx={hp.x} cy={hp.y} r="4.5" fill="#E11D48" stroke="white" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>0 km</span>
        <span>{(totalDistKm / 2).toFixed(1)} km</span>
        <span>{totalDistKm.toFixed(2)} km</span>
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
  const { t } = useLang();
  const [reelState, setReelState] = useState<"idle" | "recording" | "done">("idle");
  const [reelUrl, setReelUrl] = useState<string | null>(null);
  const [reelQuality, setReelQuality] = useState<"standard" | "alta">("standard");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const map3dRef = useRef<AnimatedMap3DHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadRef = useRef<{ tiltCanvas: OffscreenCanvas; coords: Array<{x:number;y:number}> } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renaming_busy, setRenamingBusy] = useState(false);

  const { data: activity, isLoading, error } = useGetActivity(id, {
    query: { enabled: !!id },
  });

  const handleDelete = async () => {
    if (!confirm(t("detail_delete_confirm"))) return;
    await deleteActivity.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
    navigate("/activities");
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (!name || name === activity?.name) { setRenaming(false); return; }
    setRenamingBusy(true);
    try {
      await fetch(`/api/activities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetActivityQueryKey(id) });
    } finally {
      setRenamingBusy(false);
      setRenaming(false);
    }
  };

  // ── Preload tile + perspective transform ────────────────────────────────────
  useEffect(() => {
    if (!activity) return;
    const pts = (activity.points as Array<{ lat: number; lon: number }>) ?? [];
    if (pts.length < 2) return;
    preloadRef.current = null;
    const W = 1080, H = 1920, MAP_H = Math.round(H * 0.72);
    const lon2t = (lon: number, z: number) => (lon + 180) / 360 * Math.pow(2, z);
    const lat2t = (lat: number, z: number) => {
      const r = lat * Math.PI / 180;
      return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
    };
    const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    let zoom = 12;
    for (let z = 16; z >= 8; z--) {
      if (lon2t(maxLon, z) - lon2t(minLon, z) <= 7 &&
          lat2t(minLat, z) - lat2t(maxLat, z) <= 7) { zoom = z; break; }
    }
    const PAD_T = 0.9;
    const tx0 = lon2t(minLon, zoom) - PAD_T, tx1 = lon2t(maxLon, zoom) + PAD_T;
    const ty0 = lat2t(maxLat, zoom) - PAD_T, ty1 = lat2t(minLat, zoom) + PAD_T;
    const TILE_PX = 256;
    const vpW = (tx1 - tx0) * TILE_PX, vpH = (ty1 - ty0) * TILE_PX;
    const tileScale = Math.min(W / vpW, MAP_H / vpH);
    const mapOffX = (W - vpW * tileScale) / 2, mapOffY = (MAP_H - vpH * tileScale) / 2;
    const toCanvasX = (lon: number) => mapOffX + (lon2t(lon, zoom) - tx0) * TILE_PX * tileScale;
    const toCanvasY = (lat: number) => mapOffY + (lat2t(lat, zoom) - ty0) * TILE_PX * tileScale;

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
    Promise.race([Promise.allSettled(tilePromises), new Promise(r => setTimeout(r, 5000))]).then(() => {
      // Flat map canvas
      const flat = new OffscreenCanvas(W, MAP_H);
      const fctx = flat.getContext("2d")!;
      fctx.fillStyle = "#e8e8e8";
      fctx.fillRect(0, 0, W, MAP_H);
      for (const t of tileImages) fctx.drawImage(t.img, t.dx, t.dy, t.dw, t.dh);

      // Perspective warp: strisce orizzontali, top più stretto
      const tilt = new OffscreenCanvas(W, MAP_H);
      const tctx = tilt.getContext("2d")!;
      const STRIPS = 300;
      const sh = MAP_H / STRIPS;
      for (let i = 0; i < STRIPS; i++) {
        const sy = i * sh;
        const frac = sy / MAP_H;
        const scale = 0.58 + 0.42 * frac;
        const dx = (W * (1 - scale)) / 2;
        tctx.drawImage(flat, 0, sy, W, sh, dx, sy, W * scale, sh);
      }
      // Vignette
      const vg = tctx.createRadialGradient(W / 2, MAP_H / 2, MAP_H * 0.32, W / 2, MAP_H / 2, MAP_H * 0.80);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.30)");
      tctx.fillStyle = vg; tctx.fillRect(0, 0, W, MAP_H);

      // Transform coordinates with matching perspective
      const perspCoords = pts.map(p => {
        const cx = toCanvasX(p.lon), cy = toCanvasY(p.lat);
        const frac = cy / MAP_H;
        const scale = 0.58 + 0.42 * frac;
        const ox = (W * (1 - scale)) / 2;
        return { x: ox + cx * scale, y: cy };
      });

      preloadRef.current = { tiltCanvas: tilt, coords: perspCoords };
    });
  }, [activity?.id]);

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
    const MAP_H = Math.round(H * 0.72);
    const STATS_Y = MAP_H;
    const fps = 30;
    const DURATION_MS = reelQuality === "alta" ? 15000 : 12000;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * fps);
    const BITRATE = reelQuality === "alta" ? 14_000_000 : 8_000_000;

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

    // ── Usa mappa precaricata (o carica al momento) ──────────────────────────
    let tiltCanvas: OffscreenCanvas;
    let perspCoords = coords;

    if (preloadRef.current) {
      tiltCanvas = preloadRef.current.tiltCanvas;
      perspCoords = preloadRef.current.coords;
    } else {
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
      await Promise.race([Promise.allSettled(tilePromises), new Promise(r => setTimeout(r, 5000))]);

      // Build flat canvas then apply perspective warp
      const flat = new OffscreenCanvas(W, MAP_H);
      const fctx = flat.getContext("2d")!;
      fctx.fillStyle = "#e8e8e8"; fctx.fillRect(0, 0, W, MAP_H);
      for (const t of tileImages) fctx.drawImage(t.img, t.dx, t.dy, t.dw, t.dh);

      tiltCanvas = new OffscreenCanvas(W, MAP_H);
      const tctx = tiltCanvas.getContext("2d")!;
      const STRIPS = 300, sh = MAP_H / STRIPS;
      for (let i = 0; i < STRIPS; i++) {
        const sy = i * sh;
        const scale = 0.58 + 0.42 * (sy / MAP_H);
        const dx2 = (W * (1 - scale)) / 2;
        tctx.drawImage(flat, 0, sy, W, sh, dx2, sy, W * scale, sh);
      }
      const vg = tctx.createRadialGradient(W / 2, MAP_H / 2, MAP_H * 0.32, W / 2, MAP_H / 2, MAP_H * 0.80);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.30)");
      tctx.fillStyle = vg; tctx.fillRect(0, 0, W, MAP_H);

      perspCoords = points.map(p => {
        const cx = toCanvasX(p.lon), cy = toCanvasY(p.lat);
        const scale = 0.58 + 0.42 * (cy / MAP_H);
        const ox = (W * (1 - scale)) / 2;
        return { x: ox + cx * scale, y: cy };
      });
    }

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
    const recorder = new MediaRecorder(combinedStream, { mimeType: reelMimeType, videoBitsPerSecond: BITRATE });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: reelMimeType.split(";")[0] });
      setReelUrl(URL.createObjectURL(blob));
      setReelState("done");
    };
    recorder.start();

    // ── Draw helpers ─────────────────────────────────────────────────────────
    const drawMapBg = () => {
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, 0, W, MAP_H);
      ctx.drawImage(tiltCanvas, 0, 0, W, MAP_H);
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

    const drawGhost = () => {
      ctx.save();
      ctx.strokeStyle = "rgba(225,29,72,0.38)";
      ctx.lineWidth = 8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      perspCoords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();
    };

    const drawProgress = (upTo: number) => {
      if (upTo < 2) return;
      const sub = perspCoords.slice(0, upTo);
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
      if (upTo < 1 || upTo >= perspCoords.length) return;
      const { x, y } = perspCoords[upTo - 1];
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
      const upTo = Math.max(2, Math.round(ease(rawT) * (perspCoords.length - 1)) + 1);
      drawMapBg();
      drawPattern();
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
        <p className="text-destructive font-semibold">{t("detail_not_found")}</p>
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
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
                className="text-2xl font-black border-b-2 border-primary bg-transparent outline-none w-60"
                disabled={renaming_busy}
              />
              <button onClick={handleRename} disabled={renaming_busy} className="text-xs px-2 py-1 bg-primary text-white rounded font-semibold disabled:opacity-60">{t("detail_rename_save")}</button>
              <button onClick={() => setRenaming(false)} className="text-xs px-2 py-1 border border-border rounded text-muted-foreground">{t("detail_rename_cancel")}</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-black">{activity.name}</h1>
              <button
                onClick={() => { setRenameValue(activity.name); setRenaming(true); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                title={t("detail_rename")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2">
            {/* Qualità */}
            <div className="flex border border-border rounded-lg overflow-hidden text-xs font-semibold">
              {(["standard", "alta"] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setReelQuality(q)}
                  disabled={reelState === "recording"}
                  className={`px-3 py-2 transition-colors ${reelQuality === q ? "bg-primary text-white" : "bg-white text-muted-foreground hover:bg-muted"}`}
                >
                  {q === "standard" ? "12s" : "HD 15s"}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleCreateReel().catch(() => setReelState("idle"))}
              disabled={reelState === "recording"}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {reelState === "recording" ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-white animate-pulse inline-block" />
                  {t("detail_recording")}
                </>
              ) : t("detail_create_reel")}
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              {t("detail_delete")}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {reelQuality === "standard" ? t("quality_label_standard") : t("quality_label_hd")}
          </p>
        </div>
      </div>

      {/* Reel pronto — anteprima + download */}
      {reelState === "done" && reelUrl && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-2xl">🎬</div>
            <div>
              <p className="font-semibold text-foreground">{t("detail_reel_ready")}</p>
              <p className="text-sm text-muted-foreground">{t("detail_reel_subtitle")}</p>
            </div>
          </div>

          {/* Anteprima video stile phone */}
          <div className="flex justify-center mb-5">
            <div className="relative" style={{ width: 160 }}>
              {/* Cornice telefono */}
              <div className="absolute inset-0 rounded-[22px] border-[5px] border-zinc-800 shadow-2xl pointer-events-none z-10" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-zinc-800 rounded-b-lg z-20" />
              <video
                ref={videoRef}
                src={reelUrl}
                autoPlay
                loop
                playsInline
                muted
                className="w-full rounded-[17px] block bg-black"
                style={{ aspectRatio: "9/16" }}
              />
              {/* Pulsante play/pausa sopra il video */}
              <button
                onClick={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  v.paused ? v.play() : v.pause();
                }}
                className="absolute inset-0 flex items-center justify-center rounded-[17px] bg-black/0 hover:bg-black/20 transition-colors z-10 group"
                aria-label="Pausa/Riproduci"
              >
                <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-3">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </button>
            </div>
          </div>

          {/* Bottoni azione */}
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
                  <path d="M12 2v13M8 7l4-5 4 5" /><path d="M20 21H4" />
                </svg>
                Condividi
              </button>
            )}
            <a
              href={reelUrl}
              download={`runreel-${activity.id}.${reelExtension}`}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v13M8 11l4 4 4-4" /><path d="M20 21H4" />
              </svg>
              Scarica {reelExtension.toUpperCase()}
            </a>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {reelQuality === "alta" ? "Alta qualità · 14 Mbps · 15 sec" : "Standard · 8 Mbps · 12 sec"}
          </p>
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
