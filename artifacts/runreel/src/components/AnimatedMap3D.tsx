import { useEffect, useRef, useState, useCallback } from "react";

type Point = { lat: number; lon: number; ele?: number; time?: string };

interface Props {
  points: Point[];
  distanceKm: number;
  elevationGainM: number;
  durationSecs: number;
  avgPaceSecPerKm: number;
}

function haversineM(p1: Point, p2: Point): number {
  const R = 6371000;
  const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1.lat * Math.PI) / 180) *
      Math.cos((p2.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(p1: Point, p2: Point): number {
  const dLon = ((p2.lon - p1.lon) * Math.PI) / 180;
  const lat1 = (p1.lat * Math.PI) / 180;
  const lat2 = (p2.lat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function lerpColor(t: number): string {
  // 0 = slow (red) → 0.5 (yellow) → 1 = fast (green)
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const u = t * 2;
    r = 220; g = Math.round(68 + (179 - 68) * u); b = Math.round(68 * (1 - u));
  } else {
    const u = (t - 0.5) * 2;
    r = Math.round(220 * (1 - u) + 34 * u);
    g = Math.round(179 + (197 - 179) * u);
    b = Math.round(94 * u);
  }
  return `rgb(${r},${g},${b})`;
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
  return `${Math.floor(secPerKm / 60)}'${(secPerKm % 60).toString().padStart(2, "0")}"`;
}

function lerpPt(p1: Point, p2: Point, t: number): [number, number] {
  return [p1.lon + (p2.lon - p1.lon) * t, p1.lat + (p2.lat - p1.lat) * t];
}

const ANIM_DURATION_MS = 16000;

// ─── Canvas fallback (no WebGL) ──────────────────────────────────────────────

function CanvasFallback({ points, segSpeeds, minSpeed, maxSpeed, cumDist, distanceKm, elevationGainM, durationSecs, avgPaceSecPerKm }: {
  points: Point[];
  segSpeeds: number[];
  minSpeed: number;
  maxSpeed: number;
  cumDist: number[];
  distanceKm: number;
  elevationGainM: number;
  durationSecs: number;
  avgPaceSecPerKm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const project = useCallback((lon: number, lat: number, W: number, H: number, pad = 40): [number, number] => {
    const latRange = maxLat - minLat || 1;
    const lonRange = maxLon - minLon || 1;
    const scale = Math.min((W - pad * 2) / lonRange, (H - pad * 2) / latRange);
    const centerX = W / 2;
    const centerY = H / 2;
    const x = centerX + (lon - (minLon + maxLon) / 2) * scale;
    const y = centerY - (lat - (minLat + maxLat) / 2) * scale;
    return [x, y];
  }, [minLat, maxLat, minLon, maxLon]);

  const draw = useCallback((prog: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0f172a");
    bg.addColorStop(1, "#1e293b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 8, 0); ctx.lineTo(i * W / 8, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 8); ctx.lineTo(W, i * H / 8); ctx.stroke();
    }

    const range = maxSpeed - minSpeed || 1;
    const totalDist = cumDist[cumDist.length - 1];
    const targetDist = prog * totalDist;

    // Full ghost route
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      const [x, y] = project(p.lon, p.lat, W, H);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Speed-colored segments up to progress
    for (let i = 0; i < segSpeeds.length; i++) {
      if (cumDist[i] >= targetDist) break;
      const normalized = (segSpeeds[i] - minSpeed) / range;
      const color = lerpColor(normalized);

      const segEnd = Math.min(cumDist[i + 1], targetDist);
      const segStart = cumDist[i];
      const segLen = cumDist[i + 1] - segStart;
      const partFrac = segLen > 0 ? (segEnd - segStart) / segLen : 1;

      const p1 = points[i];
      const p2 = points[i + 1];
      const endLon = p1.lon + (p2.lon - p1.lon) * partFrac;
      const endLat = p1.lat + (p2.lat - p1.lat) * partFrac;

      const [x1, y1] = project(p1.lon, p1.lat, W, H);
      const [x2, y2] = project(endLon, endLat, W, H);

      ctx.shadowBlur = 6;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Runner dot
    if (prog > 0 && prog < 1) {
      let lo = 0, hi = cumDist.length - 1;
      while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumDist[mid] <= targetDist) lo = mid; else hi = mid;
      }
      const frac = cumDist[hi] - cumDist[lo] > 0
        ? (targetDist - cumDist[lo]) / (cumDist[hi] - cumDist[lo]) : 0;
      const rp = lerpPt(points[lo], points[hi], frac);
      const [rx, ry] = project(rp[0], rp[1], W, H);

      ctx.beginPath();
      ctx.arc(rx, ry, 9, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.shadowBlur = 12;
      ctx.shadowColor = "#E11D48";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#E11D48";
      ctx.fill();
    }

    // Start / end dots
    const [sx, sy] = project(points[0].lon, points[0].lat, W, H);
    const [ex, ey] = project(points[points.length - 1].lon, points[points.length - 1].lat, W, H);
    [[sx, sy, "#22c55e"], [ex, ey, "#E11D48"]].forEach(([x, y, c]) => {
      ctx.beginPath();
      ctx.arc(x as number, y as number, 6, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x as number, y as number, 4, 0, Math.PI * 2);
      ctx.fillStyle = c as string;
      ctx.fill();
    });
  }, [points, project, segSpeeds, minSpeed, maxSpeed, cumDist]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      const ctx2 = canvas.getContext("2d");
      if (ctx2) ctx2.scale(dpr, dpr);
    };
    const observer = new ResizeObserver(() => { resizeCanvas(); draw(progress); });
    observer.observe(canvas);
    resizeCanvas();
    draw(progress);
    return () => observer.disconnect();
  }, [draw, progress]);

  const stopAnim = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setPlaying(false);
  }, []);

  const startAnim = useCallback(() => {
    setPlaying(true);
    const startProg = progress >= 1 ? 0 : progress;
    const startWall = performance.now() - startProg * ANIM_DURATION_MS;

    const tick = (now: number) => {
      const t = Math.min((now - startWall) / ANIM_DURATION_MS, 1);
      setProgress(t);
      draw(t);
      if (t < 1) animRef.current = requestAnimationFrame(tick);
      else { animRef.current = null; setPlaying(false); }
    };
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
  }, [progress, draw]);

  const handleReset = useCallback(() => {
    stopAnim();
    setProgress(0);
    draw(0);
  }, [stopAnim, draw]);

  const stats = [
    { label: "Distanza", value: `${distanceKm.toFixed(2)} km` },
    { label: "Dislivello", value: `+${Math.round(elevationGainM)} m` },
    { label: "Passo medio", value: formatPace(avgPaceSecPerKm) + "/km" },
    { label: "Tempo", value: formatDuration(durationSecs) },
  ];

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border bg-slate-900" style={{ height: 440 }}>
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: "block" }} />

      {/* Stats */}
      <div className="absolute top-3 left-3 grid grid-cols-2 gap-1.5 z-10">
        {stats.map((s) => (
          <div key={s.label} className="bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-white">
            <div className="text-[9px] text-white/50 uppercase tracking-wider">{s.label}</div>
            <div className="text-xs font-bold leading-tight">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Speed legend */}
      <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-white z-10">
        <div className="text-[9px] text-white/50 uppercase tracking-wider mb-1">Velocità</div>
        <div className="w-20 h-2 rounded-full" style={{ background: "linear-gradient(to right,#dc4444,#dbb308,#22c55e)" }} />
        <div className="flex justify-between text-[8px] text-white/40 mt-0.5"><span>lento</span><span>veloce</span></div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
        <div className="bg-black/65 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-3">
          <button onClick={handleReset} className="text-white/70 hover:text-white transition-colors" title="Ricomincia">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            </svg>
          </button>
          <button onClick={playing ? stopAnim : startAnim}
            className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:bg-primary/90 transition-colors">
            {playing
              ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>}
          </button>
          <div className="w-24 h-1.5 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full" style={{ width: `${progress * 100}%`, transition: "none" }} />
          </div>
          <span className="text-white/60 text-[11px] tabular-nums w-7">{Math.round(progress * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── MapLibre 3D map ──────────────────────────────────────────────────────────

// Minimal offline MapLibre style — no network requests, loads instantly
const OFFLINE_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0f172a" } },
  ],
};

export default function AnimatedMap3D({ points, distanceKm, elevationGainM, durationSecs, avgPaceSecPerKm }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const animRef = useRef<number | null>(null);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);

  const segmentData = useRef<{ speeds: number[]; minSpeed: number; maxSpeed: number; cumDist: number[] } | null>(null);

  useEffect(() => {
    if (points.length < 2) return;
    const speeds: number[] = [];
    const cumDist: number[] = [0];
    let totalDist = 0;
    for (let i = 1; i < points.length; i++) {
      const dist = haversineM(points[i - 1], points[i]);
      totalDist += dist;
      cumDist.push(totalDist);
      let speed = 0;
      if (points[i - 1].time && points[i].time) {
        const dt = (new Date(points[i].time!).getTime() - new Date(points[i - 1].time!).getTime()) / 1000;
        speed = dt > 0 ? dist / dt : 0;
      } else {
        speed = dist;
      }
      speeds.push(speed);
    }
    const valid = speeds.filter((s) => s > 0);
    segmentData.current = {
      speeds,
      minSpeed: valid.length ? Math.min(...valid) : 0,
      maxSpeed: valid.length ? Math.max(...valid) : 1,
      cumDist,
    };
  }, [points]);

  const buildSegmentFeatures = useCallback(() => {
    if (!segmentData.current) return [];
    const { speeds, minSpeed, maxSpeed } = segmentData.current;
    const range = maxSpeed - minSpeed || 1;
    return speeds.map((spd, i) => ({
      type: "Feature",
      properties: { color: lerpColor((spd - minSpeed) / range) },
      geometry: {
        type: "LineString",
        coordinates: [[points[i].lon, points[i].lat], [points[i + 1].lon, points[i + 1].lat]],
      },
    }));
  }, [points]);

  const getPositionAtProgress = useCallback((t: number): { coord: [number, number]; bearing: number } => {
    if (!segmentData.current) return { coord: [points[0].lon, points[0].lat], bearing: 0 };
    const { cumDist } = segmentData.current;
    const totalDist = cumDist[cumDist.length - 1];
    const targetDist = t * totalDist;
    let lo = 0, hi = cumDist.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (cumDist[mid] <= targetDist) lo = mid; else hi = mid;
    }
    const frac = cumDist[hi] - cumDist[lo] > 0 ? (targetDist - cumDist[lo]) / (cumDist[hi] - cumDist[lo]) : 0;
    return { coord: lerpPt(points[lo], points[hi], frac), bearing: bearingDeg(points[lo], points[hi]) };
  }, [points]);

  const getPartialGeoJSON = useCallback((t: number) => {
    if (!segmentData.current || points.length < 2) return { type: "FeatureCollection", features: [] };
    const { cumDist } = segmentData.current;
    const totalDist = cumDist[cumDist.length - 1];
    const targetDist = t * totalDist;
    const coords: [number, number][] = [];
    for (let i = 0; i < points.length; i++) {
      if (cumDist[i] <= targetDist) { coords.push([points[i].lon, points[i].lat]); }
      else {
        const frac = cumDist[i] - (cumDist[i - 1] ?? 0) > 0
          ? (targetDist - (cumDist[i - 1] ?? 0)) / (cumDist[i] - (cumDist[i - 1] ?? 0)) : 0;
        coords.push(lerpPt(points[i - 1], points[i], frac));
        break;
      }
    }
    if (coords.length < 2) return { type: "FeatureCollection", features: [] };
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] };
  }, [points]);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    // Test WebGL availability before loading MapLibre
    const testCanvas = document.createElement("canvas");
    const gl = testCanvas.getContext("webgl") || testCanvas.getContext("experimental-webgl");
    if (!gl) {
      setWebglFailed(true);
      return;
    }

    type MapType = {
      remove(): void;
      on(event: string, cb: () => void): void;
      fitBounds(bounds: [[number, number], [number, number]], opts?: object): void;
      easeTo(opts: object): void;
      getSource(id: string): { setData(data: object): void } | undefined;
      addSource(id: string, source: object): void;
      addLayer(layer: object): void;
    };
    let map: MapType;

    import("maplibre-gl").then((ml) => {
      if (!containerRef.current) return;
      import("maplibre-gl/dist/maplibre-gl.css");

      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLon = Math.min(...lons), maxLon = Math.max(...lons);

      try {
        map = new ml.Map({
          container: containerRef.current,
          style: OFFLINE_STYLE as unknown as string,
          center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
          pitch: 50,
          bearing: -20,
        }) as MapType;
      } catch {
        setWebglFailed(true);
        return;
      }

      mapRef.current = map;

      map.on("error", () => setWebglFailed(true));

      // Safety: fall back to canvas if map doesn't become ready in 2.5s
      loadTimerRef.current = setTimeout(() => {
        if (!mapRef.current) return;
        setWebglFailed(true);
      }, 2500);

      // With offline style, load can fire before listener is attached — handle both
      const onLoaded = () => {
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        try {
          const coords = points.map((p) => [p.lon, p.lat] as [number, number]);

          // Full route as visible base layer
          map.addSource("route-ghost", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] },
          });
          map.addLayer({ id: "route-ghost", type: "line", source: "route-ghost", paint: { "line-color": "rgba(255,255,255,0.25)", "line-width": 4, "line-cap": "round", "line-join": "round" } });

          // Speed-colored segments — compute inline so we don't depend on segmentData ref timing
          const segFeatures = buildSegmentFeatures();
          const speedFeatures = segFeatures.length > 0 ? segFeatures : (() => {
            // Fallback: color by position along route (green→red)
            const n = points.length - 1;
            return points.slice(0, -1).map((p, i) => ({
              type: "Feature",
              properties: { color: lerpColor(i / Math.max(n, 1)) },
              geometry: { type: "LineString", coordinates: [[p.lon, p.lat], [points[i + 1].lon, points[i + 1].lat]] },
            }));
          })();
          map.addSource("route-speed", { type: "geojson", data: { type: "FeatureCollection", features: speedFeatures } });
          map.addLayer({ id: "route-speed", type: "line", source: "route-speed", paint: { "line-color": ["get", "color"], "line-width": 5, "line-cap": "round", "line-join": "round" } });

          map.addSource("route-progress", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "route-progress", type: "line", source: "route-progress", paint: { "line-color": "#ffffff", "line-width": 4, "line-cap": "round", "line-join": "round", "line-opacity": 0.9 } });

          map.addSource("runner", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[0] } } });
          map.addLayer({ id: "runner-outer", type: "circle", source: "runner", paint: { "circle-radius": 10, "circle-color": "#ffffff", "circle-stroke-width": 3, "circle-stroke-color": "#E11D48" } });
          map.addLayer({ id: "runner-inner", type: "circle", source: "runner", paint: { "circle-radius": 5, "circle-color": "#E11D48" } });

          map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, pitch: 50, bearing: -20, duration: 800 });
          setReady(true);
        } catch {
          setWebglFailed(true);
        }
      };

      const mapWithCheck = map as MapType & { isStyleLoaded(): boolean };
      if (mapWithCheck.isStyleLoaded()) {
        onLoaded();
      } else {
        map.on("load", onLoaded);
      }
    }).catch(() => setWebglFailed(true));

    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (mapRef.current) (mapRef.current as { remove(): void }).remove();
      mapRef.current = null;
    };
  }, [points, buildSegmentFeatures]);

  const stopAnimation = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setPlaying(false);
  }, []);

  const startAnimation = useCallback(() => {
    if (!mapRef.current || !segmentData.current) return;
    const map = mapRef.current as { easeTo(o: object): void; getSource(id: string): { setData(d: object): void } | undefined };
    setPlaying(true);
    const startProg = progress >= 1 ? 0 : progress;
    const startWall = performance.now() - startProg * ANIM_DURATION_MS;

    const tick = (now: number) => {
      const t = Math.min((now - startWall) / ANIM_DURATION_MS, 1);
      setProgress(t);
      const { coord, bearing } = getPositionAtProgress(t);
      map.getSource("runner")?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coord } });
      map.getSource("route-progress")?.setData(getPartialGeoJSON(t) as object);
      map.easeTo({ center: coord, bearing: bearing - 20, pitch: 52, duration: 200, easing: (x: number) => x });
      if (t < 1) animRef.current = requestAnimationFrame(tick);
      else { animRef.current = null; setPlaying(false); }
    };
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
  }, [progress, getPositionAtProgress, getPartialGeoJSON]);

  const handleReset = useCallback(() => {
    stopAnimation();
    setProgress(0);
    if (!mapRef.current) return;
    const map = mapRef.current as { getSource(id: string): { setData(d: object): void } | undefined; fitBounds(b: [[number, number], [number, number]], o?: object): void };
    map.getSource("runner")?.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [points[0].lon, points[0].lat] } });
    map.getSource("route-progress")?.setData({ type: "FeatureCollection", features: [] });
    const lats = points.map((p) => p.lat), lons = points.map((p) => p.lon);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, pitch: 50, bearing: -20, duration: 800 });
  }, [stopAnimation, points]);

  // ── Canvas fallback if WebGL unavailable ──
  if (webglFailed && segmentData.current) {
    const { speeds, minSpeed, maxSpeed, cumDist } = segmentData.current;
    return (
      <CanvasFallback
        points={points}
        segSpeeds={speeds}
        minSpeed={minSpeed}
        maxSpeed={maxSpeed}
        cumDist={cumDist}
        distanceKm={distanceKm}
        elevationGainM={elevationGainM}
        durationSecs={durationSecs}
        avgPaceSecPerKm={avgPaceSecPerKm}
      />
    );
  }

  const stats = [
    { label: "Distanza", value: `${distanceKm.toFixed(2)} km` },
    { label: "Dislivello", value: `+${Math.round(elevationGainM)} m` },
    { label: "Passo medio", value: formatPace(avgPaceSecPerKm) + "/km" },
    { label: "Tempo", value: formatDuration(durationSecs) },
  ];

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border" style={{ height: 480 }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Stats overlay */}
      <div className="absolute top-3 left-3 grid grid-cols-2 gap-2 z-10">
        {stats.map((s) => (
          <div key={s.label} className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white">
            <div className="text-[10px] text-white/60 uppercase tracking-wider">{s.label}</div>
            <div className="text-sm font-bold leading-tight">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Speed legend */}
      <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white z-10">
        <div className="text-[10px] text-white/60 uppercase tracking-wider mb-1.5">Velocità</div>
        <div className="w-24 h-2.5 rounded-full" style={{ background: "linear-gradient(to right,#dc4444,#dbb308,#22c55e)" }} />
        <div className="flex justify-between text-[9px] text-white/50 mt-0.5"><span>lento</span><span>veloce</span></div>
      </div>

      {/* Controls */}
      {ready && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
          <div className="bg-black/65 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-3">
            <button onClick={handleReset} className="text-white/70 hover:text-white transition-colors" title="Ricomincia">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
              </svg>
            </button>
            <button onClick={playing ? stopAnimation : startAnimation}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:bg-primary/90 transition-colors">
              {playing
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>}
            </button>
            <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full" style={{ width: `${progress * 100}%`, transition: "none" }} />
            </div>
            <span className="text-white/70 text-xs tabular-nums w-8">{Math.round(progress * 100)}%</span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
          <div className="flex items-center gap-2 text-white/60 text-sm">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Preparazione mappa…
          </div>
        </div>
      )}
    </div>
  );
}
