import { useParams, useLocation } from "wouter";
import { useGetActivity, useDeleteActivity, getListActivitiesQueryKey, getGetStatsSummaryQueryKey, getGetActivityQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import AnimatedMap3D, { type AnimatedMap3DHandle } from "@/components/AnimatedMap3D";
import { useLang } from "@/lib/i18n";

const CesiumReel    = lazy(() => import('@/components/CesiumReel'));
const ReelOptions   = lazy(() => import('@/components/ReelOptions'));
const PhotoOverlay  = lazy(() => import('@/components/PhotoOverlay'));

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
  const [reelOptionsOpen, setReelOptionsOpen] = useState(false);
  const [cesiumReelOpen, setCesiumReelOpen] = useState(false);
  const [photoOverlayOpen, setPhotoOverlayOpen] = useState(false);
  const [iosPreviewMode, setIosPreviewMode] = useState(false);
  const [iosPreviewProgress, setIosPreviewProgress] = useState(0);
  const [reelProgress, setReelProgress] = useState(0);
  const [reelDuration, setReelDuration] = useState(20);
  const [reelFormat, setReelFormat] = useState<'9:16' | '16:9'>('9:16');
  const [reelQualityOpt, setReelQualityOpt] = useState<'standard' | 'hd'>('standard');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const map3dRef = useRef<AnimatedMap3DHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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


  const reelMimeType = (() => {
    const candidates = [
      "video/mp4; codecs=avc1",
      "video/mp4",
      "video/webm; codecs=vp9",
      "video/webm; codecs=vp8",
      "video/webm",
    ];
    return candidates.find(t => {
      try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
    }) ?? "";
  })();
  const reelExtension = reelMimeType.startsWith("video/mp4") ? "mp4" : "webm";

  const handleCreateReel = async (
    durationSecs = 12,
    format: '9:16' | '16:9' = '9:16',
    quality: 'standard' | 'hd' = 'standard'
  ) => {
    if (!activity) return;
    const points = (activity.points as Array<{ lat: number; lon: number; ele?: number }>) ?? [];
    if (points.length < 2) return;

    setReelState("recording");
    setReelUrl(null);
    setReelProgress(0);

    const isLandscape = format === '16:9';
    const W = isLandscape ? 1920 : 1080;
    const H = isLandscape ? 1080 : 1920;
    // Landscape: mappa full-frame, stats overlay al fondo (70%–100%)
    const MAP_H = H; // sempre piena altezza; in portrait la clip viene gestita da STATS_Y
    const STATS_Y = isLandscape ? Math.round(H * 0.70) : Math.round(H * 0.72);
    const fps = 30;
    const DURATION_MS = durationSecs * 1000;
    const TOTAL_FRAMES = Math.round((DURATION_MS / 1000) * fps);
    const BITRATE = quality === 'hd' ? 16_000_000 : 8_000_000;

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

    // ── Elevation ────────────────────────────────────────────────────────────
    const elevs = points.map(p => p.ele ?? 0);
    const minEle = Math.min(...elevs), maxEle = Math.max(...elevs);
    const eleRange = maxEle - minEle;
    const hasElev = eleRange > 1;

    // Dislivello positivo cumulativo per ogni punto
    const cumEleGain: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = i === 0 ? 0 : cumEleGain[i - 1];
      const gain = i === 0 ? 0 : Math.max(0, elevs[i] - elevs[i - 1]);
      cumEleGain.push(prev + gain);
    }

    // ── Mappa piatta: carica tile ─────────────────────────────────────────────
    type TileImg = { img: HTMLImageElement; dx: number; dy: number; dw: number; dh: number };
    const tileImages: TileImg[] = [];
    {
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
    }

    // Costruisce canvas piatto con vignette
    const mapBg = new OffscreenCanvas(W, MAP_H);
    {
      const fctx = mapBg.getContext("2d")!;
      fctx.fillStyle = "#e8e8e8"; fctx.fillRect(0, 0, W, MAP_H);
      for (const t of tileImages) fctx.drawImage(t.img, t.dx, t.dy, t.dw, t.dh);
      const vg = fctx.createRadialGradient(W / 2, MAP_H / 2, MAP_H * 0.28, W / 2, MAP_H / 2, MAP_H * 0.75);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.22)");
      fctx.fillStyle = vg; fctx.fillRect(0, 0, W, MAP_H);
    }

    // Coordinate flat (no warp prospettico, no offset elevazione)
    const perspCoords = points.map((p, i) => {
      const x = toCanvasX(p.lon), y = toCanvasY(p.lat);
      return { x, y, flatY: y, ele: elevs[i] };
    });

    // ── Canvas setup ─────────────────────────────────────────────────────────
    const canvas = canvasRef.current!;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // ── Musica rock — loop 8-battute con sezioni A/B/fill ────────────────────
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    try {
      const audioCtx = new AudioContext();
      audioDest = audioCtx.createMediaStreamDestination();
      const bpm = 142 + Math.floor(Math.random() * 20); // 142–161
      const bs = 60 / bpm; // durata un beat in secondi
      const totalBeats = Math.ceil(DURATION_MS / 1000 / bs) + 12;
      const t0 = audioCtx.currentTime + 0.05;
      const roots = [110, 116.5, 123.5, 130.8, 138.6];
      const root = roots[Math.floor(Math.random() * roots.length)];

      const comp = audioCtx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 6;
      comp.attack.value = 0.001; comp.release.value = 0.10;
      comp.connect(audioDest);

      const kick = (t: number, vel = 1) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g); g.connect(comp);
        o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);
        g.gain.setValueAtTime(2.0 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
        const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
        o2.type = "sine"; o2.frequency.setValueAtTime(52, t); o2.frequency.exponentialRampToValueAtTime(18, t + 0.18);
        g2.gain.setValueAtTime(1.4 * vel, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        o2.connect(g2); g2.connect(comp); o2.start(t); o2.stop(t + 0.22);
      };

      const snare = (t: number, vel = 1) => {
        const len = Math.floor(audioCtx.sampleRate * 0.2);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const bp = audioCtx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.4;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(1.6 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        src.connect(bp); bp.connect(g); g.connect(comp); src.start(t);
        const o = audioCtx.createOscillator(), og = audioCtx.createGain();
        o.frequency.value = 195; o.connect(og); og.connect(comp);
        og.gain.setValueAtTime(0.35 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        o.start(t); o.stop(t + 0.09);
      };

      const hihat = (t: number, vol: number, open = false) => {
        const dur = open ? 0.20 : 0.032;
        const len = Math.floor(audioCtx.sampleRate * dur);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = audioCtx.createBufferSource(); src.buffer = buf;
        const hp = audioCtx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 10500;
        const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(hp); hp.connect(g); g.connect(comp); src.start(t);
      };

      // Power chord distorto (fondamentale + quinta + ottava)
      const mkDist = () => {
        const ws = audioCtx.createWaveShaper();
        const n = 512, curve = new Float32Array(n), k = 90;
        for (let i = 0; i < n; i++) { const x = (2 * i) / n - 1; curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)); }
        ws.curve = curve; return ws;
      };
      const guitar = (t: number, freq: number, dur: number, vol = 1) => {
        [freq, freq * 1.498, freq * 2].forEach((f, fi) => {
          const o = audioCtx.createOscillator(), g = audioCtx.createGain();
          o.type = "sawtooth"; o.frequency.value = f;
          const ws = mkDist();
          const lp = audioCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
          o.connect(ws); ws.connect(lp); lp.connect(g); g.connect(comp);
          const v = (fi === 0 ? 0.26 : 0.16) * vol;
          g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          o.start(t); o.stop(t + dur + 0.04);
        });
      };

      // Basso (fondamentale un'ottava sotto, breve, percussivo)
      const bass = (t: number, freq: number, dur: number) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sawtooth"; o.frequency.value = freq / 2;
        const lp = audioCtx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
        o.connect(lp); lp.connect(g); g.connect(comp);
        g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        o.start(t); o.stop(t + dur + 0.02);
      };

      // 3 progressioni di accordi casuali (ratios rispetto a root)
      const progressions = [
        [1, 0.75, 0.89, 0.75],   // i–VI–VII–VI
        [1, 0.89, 0.75, 0.89],   // i–VII–VI–VII
        [1, 1.19, 0.89, 1.0],    // i–III–VII–i
      ];
      const prog = progressions[Math.floor(Math.random() * progressions.length)];

      // Struttura a frase da 8 battute:
      //  Bar 0-1: sezione A (groove base)
      //  Bar 2-3: sezione A con variazione kick
      //  Bar 4-5: sezione B (high-energy, guitar stab)
      //  Bar 6:   sezione B con open hihat
      //  Bar 7:   fill batteria + crash
      for (let b = 0; b < totalBeats; b++) {
        const t = t0 + b * bs;
        const beat = b % 4;
        const bar = Math.floor(b / 4);
        const phraseBar = bar % 8;
        const chordFreq = root * prog[Math.floor(phraseBar / 2) % prog.length];
        const isFill = phraseBar === 7;
        const isHigh = phraseBar >= 4 && phraseBar <= 6;

        // ── Batteria ──
        if (isFill) {
          if (beat === 0) { kick(t); snare(t + bs * 0.25); kick(t + bs * 0.5); snare(t + bs * 0.75); }
          if (beat === 1) { kick(t); kick(t + bs * 0.33); snare(t + bs * 0.66); }
          if (beat === 2) { snare(t, 1.2); kick(t + bs * 0.33); snare(t + bs * 0.66); }
          if (beat === 3) { kick(t); snare(t + bs * 0.17); kick(t + bs * 0.33); snare(t + bs * 0.5); kick(t + bs * 0.67); snare(t + bs * 0.83); }
          hihat(t, 0.14);
        } else {
          if (beat === 0) kick(t);
          if (beat === 2) kick(t);
          if (isHigh && beat === 3) kick(t + bs * 0.5);       // kick anticipato
          if (phraseBar % 2 === 1 && beat === 1) kick(t + bs * 0.5); // sincopato
          if (beat === 1 || beat === 3) snare(t);
          if (isHigh && beat === 0) snare(t + bs * 0.5, 0.28); // ghost snare
          hihat(t, isHigh ? 0.32 : 0.26);
          hihat(t + bs * 0.5, isHigh ? 0.22 : 0.16);
          if (isHigh) { hihat(t + bs * 0.25, 0.15); hihat(t + bs * 0.75, 0.15); }
          if (phraseBar === 3 && beat === 2) hihat(t + bs * 0.5, 0.38, true);
          if (phraseBar === 6 && beat === 2) hihat(t + bs * 0.5, 0.38, true);
        }
        // Crash all'inizio di ogni frase
        if (phraseBar === 0 && beat === 0) hihat(t, 0.62, true);

        // ── Chitarra ──
        if (beat === 0) {
          if (isFill) {
            guitar(t, chordFreq, 0.18, 0.8);
          } else if (isHigh) {
            guitar(t, chordFreq, bs * 1.6);
            if (beat === 0) guitar(t + bs * 2.5, chordFreq * 1.19, 0.18, 0.7); // stab su 3-e
          } else {
            guitar(t, chordFreq, bs * 3.6);
          }
        }
        // Upstroke di passaggio ogni 4 battute
        if (phraseBar % 4 === 3 && beat === 3) guitar(t + bs * 0.5, root * prog[(phraseBar + 1) % prog.length], 0.15, 0.6);

        // ── Basso ──
        if (beat === 0) bass(t, chordFreq, bs * 0.85);
        if (isHigh && beat === 2) bass(t, chordFreq * 0.75, bs * 0.4);
      }
    } catch { /* audio non supportato */ }

    // ── MediaRecorder (video + audio) — solo se captureStream disponibile ─────
    const captureOk = typeof (canvas as { captureStream?: unknown }).captureStream === 'function';
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];

    if (captureOk) {
      let videoStream: MediaStream;
      try {
        videoStream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(fps);
      } catch (err) {
        console.error("captureStream failed:", err);
        setReelState("idle");
        return;
      }
      const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];
      if (audioDest) tracks.push(...audioDest.stream.getAudioTracks());
      const combinedStream = new MediaStream(tracks);
      try {
        const recOpts: MediaRecorderOptions = { videoBitsPerSecond: BITRATE };
        if (reelMimeType) recOpts.mimeType = reelMimeType;
        recorder = new MediaRecorder(combinedStream, recOpts);
      } catch (err) {
        console.error("MediaRecorder init failed:", err);
        setReelState("idle");
        return;
      }
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => setReelState("idle");
      recorder.onstop = () => {
        if (chunks.length === 0) { setReelState("idle"); return; }
        const blobType = reelMimeType.split(";")[0] || "video/webm";
        const blob = new Blob(chunks, { type: blobType });
        setReelUrl(URL.createObjectURL(blob));
        setReelState("done");
      };
      try {
        recorder.start(200);
      } catch (err) {
        console.error("recorder.start failed:", err);
        setReelState("idle");
        return;
      }
    } else {
      // iOS Safari: nessuna registrazione — mostra canvas fullscreen per Registrazione Schermo
      setIosPreviewMode(true);
      setIosPreviewProgress(0);
    }

    // ── Draw helpers ─────────────────────────────────────────────────────────
    const drawMapBg = () => {
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, 0, W, MAP_H);
      ctx.drawImage(mapBg, 0, 0, W, MAP_H);
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
      // Traccia ghost tratteggiata (visibile sotto la traccia animata)
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.20)";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.setLineDash([14, 20]);
      ctx.beginPath();
      perspCoords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      // Alone rosso sottile (indicatore percorso totale)
      ctx.save();
      ctx.strokeStyle = "rgba(225,29,72,0.18)";
      ctx.lineWidth = 10;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      perspCoords.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();
    };

    // Colore segmento per quota (verde→arancio→rosso)
    const allEles = perspCoords.map(c => c.ele);
    const globalMinEle = Math.min(...allEles), globalMaxEle = Math.max(...allEles);
    const globalEleRange = globalMaxEle - globalMinEle || 1;
    const eleColor = (e: number) => {
      const t = (e - globalMinEle) / globalEleRange;
      if (t < 0.5) {
        const r = Math.round(52 + (255 - 52) * (t * 2));
        const g = Math.round(211 - (211 - 100) * (t * 2));
        return `rgb(${r},${g},50)`;
      }
      const r = 255, g = Math.round(100 * (1 - (t - 0.5) * 2));
      return `rgb(${r},${g},30)`;
    };

    const drawProgress = (upTo: number, glowBoost = 1) => {
      if (upTo < 2) return;
      const sub = perspCoords.slice(0, upTo);

      // Glow esterno
      ctx.save();
      ctx.shadowBlur = 36 * glowBoost; ctx.shadowColor = "#E11D48";
      ctx.strokeStyle = `rgba(225,29,72,${0.28 * glowBoost})`; ctx.lineWidth = 22;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      sub.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();

      // Segmenti colorati per quota
      ctx.save();
      ctx.lineWidth = 14; ctx.lineJoin = "round"; ctx.lineCap = "round";
      for (let i = 1; i < sub.length; i++) {
        const a = sub[i - 1], b = sub[i];
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        grad.addColorStop(0, eleColor(a.ele));
        grad.addColorStop(1, eleColor(b.ele));
        ctx.strokeStyle = grad;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();

      // Nucleo bianco
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * Math.min(glowBoost, 1)})`; ctx.lineWidth = 4;
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath();
      sub.forEach((c, i) => i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y));
      ctx.stroke();
      ctx.restore();
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

    // Scale stats panel to available area (9:16 → 538px tall, 16:9 → 302px tall)
    const STATS_H = H - STATS_Y;
    const S = Math.min(W / 1080, STATS_H / 538); // uniform scale factor
    const PAD = Math.round(60 * S);

    const drawStats = (rawT: number, upTo: number) => {
      // ── Landscape (16:9) — overlay con layout orizzontale ──────────────────
      if (isLandscape) {
        const Sl = H / 1080;
        const PAD_L = Math.round(56 * Sl);
        const OVERLAY_TOP = STATS_Y - Math.round(70 * Sl);
        const grad = ctx.createLinearGradient(0, OVERLAY_TOP, 0, H);
        grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(0.28, "rgba(0,0,0,0.82)"); grad.addColorStop(1, "rgba(0,0,0,0.96)");
        ctx.fillStyle = grad; ctx.fillRect(0, OVERLAY_TOP, W, H - OVERLAY_TOP);
        ctx.fillStyle = "#E11D48"; ctx.fillRect(0, STATS_Y, W, Math.max(2, Math.round(3 * Sl)));
        ctx.textAlign = "left";
        ctx.fillStyle = "#E11D48"; ctx.font = `bold ${Math.round(52 * Sl)}px Inter,system-ui,sans-serif`;
        ctx.fillText("RunReel", PAD_L, STATS_Y + Math.round(66 * Sl));
        ctx.fillStyle = "#fff"; ctx.font = `${Math.round(32 * Sl)}px Inter,system-ui,sans-serif`;
        const nmx = Math.round(40 * (W / 1920));
        const nm = activity.name.length > nmx ? activity.name.slice(0, nmx - 1) + "…" : activity.name;
        ctx.fillText(nm, PAD_L, STATS_Y + Math.round(106 * Sl));
        ctx.globalAlpha = Math.min(1, rawT * 4);
        const cW = Math.round(296 * Sl), cH = Math.round(118 * Sl), cGap = Math.round(12 * Sl);
        const cStartX = PAD_L + Math.round(420 * Sl), cY = STATS_Y + Math.round(12 * Sl);
        const cardL = (idx: number, big: string, small: string) => {
          const cx = cStartX + idx * (cW + cGap);
          ctx.fillStyle = "rgba(255,255,255,0.11)";
          ctx.beginPath(); ctx.roundRect(cx, cY, cW, cH, Math.round(10 * Sl)); ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(38 * Sl)}px Inter,system-ui,sans-serif`;
          ctx.fillText(big, cx + Math.round(14 * Sl), cY + Math.round(54 * Sl));
          ctx.fillStyle = "rgba(255,255,255,0.52)"; ctx.font = `${Math.round(24 * Sl)}px Inter,system-ui,sans-serif`;
          ctx.fillText(small, cx + Math.round(14 * Sl), cY + Math.round(90 * Sl));
        };
        const pace = activity.avgPaceSecPerKm ?? 0, dur = activity.durationSecs ?? 0;
        cardL(0, `${activity.distanceKm?.toFixed(2)} km`, "distanza");
        cardL(1, `${Math.floor(pace/60)}:${(pace%60).toString().padStart(2,"0")}/km`, "passo");
        cardL(2, `${Math.floor(dur/3600)}h ${Math.floor((dur%3600)/60)}'`, "durata");
        const hasEleL = perspCoords.some(c => c.ele > 0);
        const cGL = cumEleGain[Math.min(upTo - 1, cumEleGain.length - 1)] ?? 0;
        cardL(3, hasEleL ? `+${Math.round(cGL)} m` : `+${Math.round(activity.elevationGainM ?? 0)} m`, "dislivello ↑");
        ctx.globalAlpha = 1;
        const bY = STATS_Y + Math.round(144 * Sl);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath(); ctx.roundRect(PAD_L, bY, W - PAD_L * 2, Math.round(7 * Sl), 4); ctx.fill();
        ctx.fillStyle = "#E11D48";
        ctx.beginPath(); ctx.roundRect(PAD_L, bY, (W - PAD_L * 2) * rawT, Math.round(7 * Sl), 4); ctx.fill();
        return;
      }
      // ── Portrait (9:16) ────────────────────────────────────────────────────
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, STATS_Y, W, STATS_H);
      ctx.fillStyle = "#E11D48";
      ctx.fillRect(0, STATS_Y, W, Math.max(3, Math.round(4 * S)));

      ctx.textAlign = "left";
      ctx.fillStyle = "#E11D48";
      ctx.font = `bold ${Math.round(72 * S)}px Inter,system-ui,sans-serif`;
      ctx.fillText("RunReel", PAD, STATS_Y + Math.round(108 * S));

      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(50 * S)}px Inter,system-ui,sans-serif`;
      const nameMax = Math.round(26 * (W / 1080));
      const name = activity.name.length > nameMax ? activity.name.slice(0, nameMax - 1) + "…" : activity.name;
      ctx.fillText(name, PAD, STATS_Y + Math.round(180 * S));

      ctx.globalAlpha = Math.min(1, rawT * 4);
      const CW = Math.round(455 * S), CH = Math.round(120 * S);
      const GAP = Math.round(10 * S);
      const col2X = PAD + CW + GAP;
      const card = (x: number, y: number, cw: number, ch: number, big: string, small: string) => {
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath(); ctx.roundRect(x, y, cw, ch, Math.round(16 * S)); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(46 * S)}px Inter,system-ui,sans-serif`;
        ctx.fillText(big, x + Math.round(24 * S), y + Math.round(66 * S));
        ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.font = `${Math.round(30 * S)}px Inter,system-ui,sans-serif`;
        ctx.fillText(small, x + Math.round(24 * S), y + Math.round(104 * S));
      };
      const pace = activity.avgPaceSecPerKm ?? 0;
      const dur = activity.durationSecs ?? 0;
      const row1Y = STATS_Y + Math.round(210 * S);
      const row2Y = STATS_Y + Math.round(350 * S);
      card(PAD,  row1Y, CW, CH, `${activity.distanceKm?.toFixed(2)} km`, "distanza");
      card(col2X, row1Y, CW, CH, `${Math.floor(pace/60)}:${(pace%60).toString().padStart(2,"0")}/km`, "passo");
      card(PAD,  row2Y, CW, CH, `${Math.floor(dur/3600)}h ${Math.floor((dur%3600)/60)}'`, "durata");
      const hasEleData = perspCoords.some(c => c.ele > 0);
      const curGain = cumEleGain[Math.min(upTo - 1, cumEleGain.length - 1)] ?? 0;
      const gainStr = hasEleData
        ? `+${Math.round(curGain)} m`
        : `+${Math.round(activity.elevationGainM ?? 0)} m`;
      card(col2X, row2Y, CW, CH, gainStr, "dislivello ↑");
      ctx.globalAlpha = 1;

      // Barra progresso
      const BAR_Y0 = STATS_Y + Math.round(500 * S);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath(); ctx.roundRect(PAD, BAR_Y0, W - PAD * 2, Math.round(10 * S), Math.round(5 * S)); ctx.fill();
      ctx.fillStyle = "#E11D48";
      ctx.beginPath(); ctx.roundRect(PAD, BAR_Y0, (W - PAD * 2) * rawT, Math.round(10 * S), Math.round(5 * S)); ctx.fill();

      // Mini sparkline altimetrico
      if (hasEleData && perspCoords.length > 1) {
        const SP_Y = BAR_Y0 + Math.round(18 * S);
        const SP_H = Math.round(32 * S);
        if (SP_Y + SP_H <= H - 4) {
          const BAR_X = PAD, BAR_W = W - PAD * 2;
          const allEles2 = perspCoords.map(c => c.ele);
          const eMin = Math.min(...allEles2), eMax = Math.max(...allEles2), eRng = eMax - eMin || 1;
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.beginPath(); ctx.roundRect(BAR_X, SP_Y, BAR_W, SP_H, 4); ctx.fill();
          ctx.beginPath();
          perspCoords.forEach((c, i) => {
            const sx = BAR_X + (i / (perspCoords.length - 1)) * BAR_W;
            const sy = SP_Y + SP_H - ((c.ele - eMin) / eRng) * SP_H;
            i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
          });
          ctx.lineTo(BAR_X + BAR_W, SP_Y + SP_H); ctx.lineTo(BAR_X, SP_Y + SP_H); ctx.closePath();
          ctx.fillStyle = "rgba(225,29,72,0.55)"; ctx.fill();
          const pIdx = Math.min(upTo - 1, perspCoords.length - 1);
          const sx = BAR_X + (pIdx / (perspCoords.length - 1)) * BAR_W;
          ctx.globalAlpha = 1;
          ctx.fillStyle = "white";
          ctx.beginPath(); ctx.arc(sx, SP_Y + SP_H / 2, Math.round(5 * S), 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    };

    // ── Animation loop ───────────────────────────────────────────────────────
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    let frame = 0;
    const FINALE = Math.round(fps * 1.8); // 1.8s di enfasi finale
    let finaleFrame = 0;
    let inFinale = false;
    const N = perspCoords.length;

    const animate = () => {
      if (!inFinale) {
        // rawT va da 0 a 1 incluso (l'ultimo frame usa t=1 → upTo=N)
        const rawT = Math.min(1, frame / TOTAL_FRAMES);
        const upTo = frame >= TOTAL_FRAMES
          ? N
          : Math.max(2, Math.round(ease(rawT) * (N - 1)) + 1);
        drawMapBg();
        drawPattern();
        drawGhost();
        drawProgress(upTo);
        drawRunner(frame, Math.min(upTo, N - 1));
        drawStats(rawT, upTo);
        if (recorder) setReelProgress(rawT);
        else setIosPreviewProgress(rawT);
        frame++;
        if (frame <= TOTAL_FRAMES) {
          requestAnimationFrame(animate);
        } else {
          inFinale = true;
          requestAnimationFrame(animate);
        }
      } else {
        // Fase finale: traccia completa + effetto glow pulsante sull'endpoint
        const ft = finaleFrame / FINALE;
        const pulse = 1 + Math.sin(ft * Math.PI * 5) * 0.55;
        const endPt = perspCoords[N - 1];
        drawMapBg();
        drawPattern();
        drawProgress(N, pulse);
        // Anelli espandenti dal punto finale
        if (endPt) {
          for (let r = 0; r < 3; r++) {
            const rPhase = (ft * 1.2 + r / 3) % 1;
            const rRadius = rPhase * 55 * S;
            const rAlpha = (1 - rPhase) * 0.85;
            ctx.save();
            ctx.strokeStyle = `rgba(225,29,72,${rAlpha})`;
            ctx.lineWidth = Math.max(1, 4 * S * (1 - rPhase));
            ctx.beginPath(); ctx.arc(endPt.x, endPt.y, rRadius, 0, Math.PI * 2);
            ctx.stroke(); ctx.restore();
          }
          // Punto fermo luminoso
          ctx.save();
          ctx.fillStyle = "#fff";
          ctx.shadowBlur = 18 * pulse; ctx.shadowColor = "#E11D48";
          ctx.beginPath(); ctx.arc(endPt.x, endPt.y, 9 * S, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
        drawStats(1, N);
        if (recorder) setReelProgress(1);
        else setIosPreviewProgress(1);
        finaleFrame++;
        if (finaleFrame < FINALE) {
          requestAnimationFrame(animate);
        } else {
          if (recorder) {
            recorder.stop();
          } else {
            setIosPreviewProgress(1);
            setTimeout(() => {
              setIosPreviewMode(false);
              setIosPreviewProgress(0);
              setReelState("idle");
            }, 800);
          }
        }
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
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => setReelOptionsOpen(true)}
              disabled={reelState === "recording" || cesiumReelOpen}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
              </svg>
              {t("detail_create_reel")}
            </button>
            <button
              onClick={() => setPhotoOverlayOpen(true)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg text-sm font-bold hover:bg-secondary/80 transition-colors flex items-center gap-1.5 border border-border"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
              </svg>
              {t("detail_photo_card")}
            </button>
            <button
              onClick={handleDelete}
              className="px-3 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              {t("detail_delete")}
            </button>
          </div>
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

          {/* Anteprima video — phone frame per 9:16, widescreen per 16:9 */}
          <div className="flex justify-center mb-5">
            {reelFormat === '9:16' ? (
              <div className="relative" style={{ width: 160 }}>
                <div className="absolute inset-0 rounded-[22px] border-[5px] border-zinc-800 shadow-2xl pointer-events-none z-10" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1.5 bg-zinc-800 rounded-b-lg z-20" />
                <video
                  ref={videoRef}
                  src={reelUrl}
                  autoPlay loop playsInline muted
                  className="w-full rounded-[17px] block bg-black"
                  style={{ aspectRatio: "9/16" }}
                />
                <button
                  onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }}
                  className="absolute inset-0 flex items-center justify-center rounded-[17px] bg-black/0 hover:bg-black/20 transition-colors z-10 group"
                >
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </button>
              </div>
            ) : (
              <div className="relative w-full max-w-sm rounded-xl overflow-hidden shadow-2xl border border-zinc-800">
                <video
                  ref={videoRef}
                  src={reelUrl}
                  autoPlay loop playsInline muted
                  className="w-full block bg-black"
                  style={{ aspectRatio: "16/9" }}
                />
                <button
                  onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }}
                  className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors group"
                >
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-3">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
                  </div>
                </button>
              </div>
            )}
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
                    const filename = `runreel-${activity.id}.${reelExtension}`;
                    const file = new File([blob], filename, { type: mimeBase });
                    const shareData = { files: [file], title: activity.name };
                    if (navigator.canShare && navigator.canShare(shareData)) {
                      await navigator.share(shareData);
                    } else {
                      // share file non supportato — fallback download diretto
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = filename;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                    }
                  } catch (err: unknown) {
                    // AbortError = utente ha annullato (ignorare)
                    if (err instanceof DOMException && err.name === "AbortError") return;
                    // Altro errore → fallback download
                    const a = document.createElement("a");
                    a.href = reelUrl;
                    a.download = `runreel-${activity.id}.${reelExtension}`;
                    a.click();
                  }
                }}
                className="flex-1 px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v13M8 7l4-5 4 5" /><path d="M20 21H4" />
                </svg>
                Condividi
              </button>
            )}
            <button
              onClick={() => {
                const a = document.createElement("a");
                a.href = reelUrl;
                a.download = `runreel-${activity.id}.${reelExtension}`;
                a.click();
              }}
              className="flex-1 px-4 py-2.5 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v13M8 11l4 4 4-4" /><path d="M20 21H4" />
              </svg>
              Scarica {reelExtension.toUpperCase()}
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {reelFormat} · {reelDuration}s · {reelQualityOpt === 'hd' ? '16 Mbps HD' : '8 Mbps Standard'}
          </p>
        </div>
      )}

      {/* Canvas reel — nascosto normalmente, fullscreen in modalità iOS */}
      <canvas ref={canvasRef} className={iosPreviewMode ? "fixed inset-0 z-50 w-screen h-screen object-contain bg-black" : "hidden"} />

      {/* Overlay iOS: hint registrazione schermo */}
      {iosPreviewMode && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex flex-col justify-between p-4">
          {/* Top: istruzione */}
          <div className="pointer-events-auto flex justify-center">
            <div className="bg-amber-500/95 text-black rounded-2xl px-4 py-3 max-w-xs shadow-2xl">
              <p className="text-sm font-bold text-center mb-0.5">📱 Registrazione Schermo attiva?</p>
              <p className="text-xs text-center leading-snug">Centro di Controllo → cerchio puntato → tieni premuto → Avvia</p>
            </div>
          </div>
          {/* Bottom: barra progresso + chiudi */}
          <div className="pointer-events-auto space-y-2">
            <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${iosPreviewProgress * 100}%` }} />
            </div>
            <button
              onClick={() => { setIosPreviewMode(false); setIosPreviewProgress(0); setReelState("idle"); }}
              className="w-full py-3 bg-white/10 text-white rounded-xl text-sm font-semibold backdrop-blur-sm border border-white/20"
            >
              Chiudi anteprima
            </button>
          </div>
        </div>
      )}

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

      {/* ── Overlay generazione video ─────────────────────────────────────── */}
      {reelState === "recording" && !iosPreviewMode && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-6 px-6">
          {/* Anello pulsante animato */}
          <div className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-24 w-24 rounded-full bg-primary/30 animate-ping" />
            <span className="absolute inline-flex h-16 w-16 rounded-full bg-primary/50 animate-ping" style={{ animationDelay: '0.2s' }} />
            <span className="relative inline-flex h-10 w-10 rounded-full bg-primary items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.87v6.26a1 1 0 0 1-1.447.9L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>
              </svg>
            </span>
          </div>

          {/* Testo */}
          <div className="text-center space-y-1">
            <p className="text-white font-bold text-lg">Generazione video…</p>
            <p className="text-white/60 text-sm">
              {reelFormat} · {reelDuration}s · {reelQualityOpt === 'hd' ? 'HD 16 Mbps' : 'Standard 8 Mbps'}
            </p>
          </div>

          {/* Barra progresso */}
          <div className="w-full max-w-xs space-y-2">
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-150"
                style={{ width: `${Math.round(reelProgress * 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-white/50">
              <span>{Math.round(reelProgress * 100)}%</span>
              <span>
                {reelProgress > 0
                  ? `~${Math.max(0, Math.round(reelDuration * (1 - reelProgress)))}s`
                  : `${reelDuration}s`}
              </span>
            </div>
          </div>

          <p className="text-white/30 text-xs text-center">
            L'elaborazione avviene sul tuo dispositivo
          </p>
        </div>
      )}

      {/* Schermata opzioni reel */}
      {reelOptionsOpen && activity && (
        <Suspense fallback={null}>
          <ReelOptions
            activityName={activity.name}
            hasElevation={((activity.elevationGainM ?? 0) > 0)}
            onCancel={() => setReelOptionsOpen(false)}
            onStart={(opts) => {
              setReelOptionsOpen(false);
              setReelDuration(opts.duration);
              setReelFormat(opts.format);
              setReelQualityOpt(opts.quality);
              if (opts.style === '3d') {
                setCesiumReelOpen(true);
              } else {
                handleCreateReel(opts.duration, opts.format, opts.quality).catch(() => setReelState("idle"));
              }
            }}
          />
        </Suspense>
      )}

      {/* CesiumJS 3D Reel overlay */}
      {cesiumReelOpen && activity && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black flex items-center justify-center text-white font-bold text-lg">
            Caricamento CesiumJS…
          </div>
        }>
          <CesiumReel
            points={(activity.points as Array<{ lat: number; lon: number; ele?: number }>) ?? []}
            activity={{
              name: activity.name,
              distanceKm: activity.distanceKm ?? null,
              durationSecs: activity.durationSecs ?? null,
              avgPaceSecPerKm: activity.avgPaceSecPerKm ?? null,
              elevationGainM: activity.elevationGainM ?? null,
            }}
            reelDuration={reelDuration}
            format={reelFormat}
            quality={reelQualityOpt}
            onComplete={(url, _ext) => {
              setReelUrl(url);
              setReelState("done");
              setCesiumReelOpen(false);
            }}
            onCancel={() => setCesiumReelOpen(false)}
          />
        </Suspense>
      )}

      {/* Photo Card overlay */}
      {photoOverlayOpen && activity && (
        <Suspense fallback={null}>
          <PhotoOverlay
            activity={{
              name: activity.name,
              date: activity.date ?? "",
              distanceKm: activity.distanceKm ?? null,
              durationSecs: activity.durationSecs ?? null,
              avgPaceSecPerKm: activity.avgPaceSecPerKm ?? null,
              elevationGainM: activity.elevationGainM ?? null,
            }}
            points={(activity.points as Array<{ lat: number; lon: number; ele?: number }>) ?? []}
            onClose={() => setPhotoOverlayOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
