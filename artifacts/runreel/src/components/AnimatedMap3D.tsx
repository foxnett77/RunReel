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

function speedColor(normalized: number): string {
  let r: number, g: number, b: number;
  if (normalized < 0.5) {
    const t = normalized * 2;
    r = 220; g = Math.round(68 + (179 - 68) * t); b = Math.round(68 * (1 - t));
  } else {
    const t = (normalized - 0.5) * 2;
    r = Math.round(220 * (1 - t) + 34 * t);
    g = Math.round(179 + (197 - 179) * t);
    b = Math.round(94 * t);
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
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

function lerp(p1: Point, p2: Point, t: number): [number, number] {
  return [p1.lon + (p2.lon - p1.lon) * t, p1.lat + (p2.lat - p1.lat) * t];
}

const ANIM_DURATION_MS = 18000;

export default function AnimatedMap3D({ points, distanceKm, elevationGainM, durationSecs, avgPaceSecPerKm }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);

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

    const validSpeeds = speeds.filter((s) => s > 0);
    const minSpeed = validSpeeds.length ? Math.min(...validSpeeds) : 0;
    const maxSpeed = validSpeeds.length ? Math.max(...validSpeeds) : 1;
    segmentData.current = { speeds, minSpeed, maxSpeed, cumDist };
  }, [points]);

  const buildSegmentFeatures = useCallback(() => {
    if (!segmentData.current) return [];
    const { speeds, minSpeed, maxSpeed } = segmentData.current;
    const range = maxSpeed - minSpeed || 1;
    const features = [];
    for (let i = 0; i < speeds.length; i++) {
      const normalized = (speeds[i] - minSpeed) / range;
      const color = speedColor(normalized);
      features.push({
        type: "Feature",
        properties: { color },
        geometry: {
          type: "LineString",
          coordinates: [
            [points[i].lon, points[i].lat],
            [points[i + 1].lon, points[i + 1].lat],
          ],
        },
      });
    }
    return features;
  }, [points]);

  const getPositionAtProgress = useCallback(
    (t: number): { coord: [number, number]; bearing: number; ptIdx: number } => {
      if (!segmentData.current) return { coord: [points[0].lon, points[0].lat], bearing: 0, ptIdx: 0 };
      const { cumDist } = segmentData.current;
      const totalDist = cumDist[cumDist.length - 1];
      const targetDist = t * totalDist;

      let lo = 0;
      let hi = cumDist.length - 1;
      while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (cumDist[mid] <= targetDist) lo = mid;
        else hi = mid;
      }

      const segFrac =
        cumDist[hi] - cumDist[lo] > 0
          ? (targetDist - cumDist[lo]) / (cumDist[hi] - cumDist[lo])
          : 0;
      const coord = lerp(points[lo], points[hi], segFrac);
      const bearing = bearingDeg(points[lo], points[hi]);
      return { coord, bearing, ptIdx: lo };
    },
    [points]
  );

  const getPartialGeoJSON = useCallback(
    (t: number) => {
      if (!segmentData.current || points.length < 2)
        return { type: "FeatureCollection", features: [] };

      const { cumDist } = segmentData.current;
      const totalDist = cumDist[cumDist.length - 1];
      const targetDist = t * totalDist;

      const coords: [number, number][] = [];
      for (let i = 0; i < points.length; i++) {
        if (cumDist[i] <= targetDist) {
          coords.push([points[i].lon, points[i].lat]);
        } else {
          const prevDist = cumDist[i - 1] ?? 0;
          const frac =
            cumDist[i] - prevDist > 0 ? (targetDist - prevDist) / (cumDist[i] - prevDist) : 0;
          const interp = lerp(points[i - 1], points[i], frac);
          coords.push(interp);
          break;
        }
      }

      if (coords.length < 2) return { type: "FeatureCollection", features: [] };

      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
          },
        ],
      };
    },
    [points]
  );

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    let map: {
      remove(): void;
      on(event: string, cb: () => void): void;
      fitBounds(bounds: [[number, number], [number, number]], opts?: object): void;
      easeTo(opts: object): void;
      getSource(id: string): { setData(data: object): void } | undefined;
      addSource(id: string, source: object): void;
      addLayer(layer: object): void;
      setPitch(p: number): void;
      setBearing(b: number): void;
    };

    import("maplibre-gl").then((ml) => {
      if (!containerRef.current) return;

      import("maplibre-gl/dist/maplibre-gl.css");

      const lats = points.map((p) => p.lat);
      const lons = points.map((p) => p.lon);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLon = Math.min(...lons);
      const maxLon = Math.max(...lons);
      const centerLat = (minLat + maxLat) / 2;
      const centerLon = (minLon + maxLon) / 2;

      map = new ml.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [centerLon, centerLat],
        pitch: 50,
        bearing: -20,
        antialias: true,
      }) as typeof map;

      mapRef.current = map;

      map.on("load", () => {
        const segFeatures = buildSegmentFeatures();

        map.addSource("route-ghost", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates: points.map((p) => [p.lon, p.lat]),
                },
              },
            ],
          },
        });
        map.addLayer({
          id: "route-ghost",
          type: "line",
          source: "route-ghost",
          paint: {
            "line-color": "rgba(0,0,0,0.12)",
            "line-width": 4,
            "line-cap": "round",
            "line-join": "round",
          },
        });

        map.addSource("route-speed", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: segFeatures,
          },
        });
        map.addLayer({
          id: "route-speed",
          type: "line",
          source: "route-speed",
          paint: {
            "line-color": ["get", "color"],
            "line-width": 5,
            "line-cap": "round",
            "line-join": "round",
          },
        });

        map.addSource("route-progress", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "route-progress",
          type: "line",
          source: "route-progress",
          paint: {
            "line-color": "#ffffff",
            "line-width": 4,
            "line-cap": "round",
            "line-join": "round",
            "line-opacity": 0.9,
          },
        });

        map.addSource("runner", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [points[0].lon, points[0].lat] },
          },
        });
        map.addLayer({
          id: "runner-outer",
          type: "circle",
          source: "runner",
          paint: {
            "circle-radius": 10,
            "circle-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-stroke-color": "#E11D48",
          },
        });
        map.addLayer({
          id: "runner-inner",
          type: "circle",
          source: "runner",
          paint: {
            "circle-radius": 5,
            "circle-color": "#E11D48",
          },
        });

        map.fitBounds(
          [
            [minLon, minLat],
            [maxLon, maxLat],
          ],
          { padding: 60, pitch: 50, bearing: -20, duration: 1200 }
        );

        setReady(true);
      });
    });

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (mapRef.current) (mapRef.current as { remove(): void }).remove();
      mapRef.current = null;
    };
  }, [points, buildSegmentFeatures]);

  const stopAnimation = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    startTimeRef.current = null;
    setPlaying(false);
  }, []);

  const startAnimation = useCallback(() => {
    if (!mapRef.current || !segmentData.current) return;
    const map = mapRef.current as {
      easeTo(opts: object): void;
      getSource(id: string): { setData(data: object): void } | undefined;
    };

    setPlaying(true);
    const startProg = progress >= 1 ? 0 : progress;
    if (startProg === 0) setProgress(0);

    const startWall = performance.now() - startProg * ANIM_DURATION_MS;
    startTimeRef.current = startWall;

    const tick = (now: number) => {
      const elapsed = now - startWall;
      const t = Math.min(elapsed / ANIM_DURATION_MS, 1);

      setProgress(t);

      const { coord, bearing } = getPositionAtProgress(t);

      const runnerSrc = map.getSource("runner");
      if (runnerSrc)
        runnerSrc.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: coord },
        });

      const progSrc = map.getSource("route-progress");
      if (progSrc) progSrc.setData(getPartialGeoJSON(t) as object);

      map.easeTo({
        center: coord,
        bearing: bearing - 20,
        pitch: 52,
        duration: 200,
        easing: (x: number) => x,
      });

      if (t < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        startTimeRef.current = null;
        setPlaying(false);
      }
    };

    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(tick);
  }, [progress, getPositionAtProgress, getPartialGeoJSON]);

  const handlePlayPause = useCallback(() => {
    if (playing) {
      stopAnimation();
    } else {
      startAnimation();
    }
  }, [playing, stopAnimation, startAnimation]);

  const handleReset = useCallback(() => {
    stopAnimation();
    setProgress(0);
    if (!mapRef.current) return;
    const map = mapRef.current as {
      getSource(id: string): { setData(data: object): void } | undefined;
      fitBounds(b: [[number, number], [number, number]], opts?: object): void;
    };
    const runnerSrc = map.getSource("runner");
    if (runnerSrc)
      runnerSrc.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [points[0].lon, points[0].lat] },
      });
    const progSrc = map.getSource("route-progress");
    if (progSrc) progSrc.setData({ type: "FeatureCollection", features: [] });

    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    map.fitBounds(
      [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: 60, pitch: 50, bearing: -20, duration: 800 }
    );
  }, [stopAnimation, points]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden border border-border" style={{ height: 480 }}>
      <div ref={containerRef} className="w-full h-full" />

      {/* Stats overlay */}
      <div className="absolute top-3 left-3 grid grid-cols-2 gap-2 z-10">
        {[
          { label: "Distanza", value: `${distanceKm.toFixed(2)} km` },
          { label: "Dislivello", value: `+${Math.round(elevationGainM)} m` },
          { label: "Passo medio", value: formatPace(avgPaceSecPerKm) + "/km" },
          { label: "Tempo", value: formatDuration(durationSecs) },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white"
          >
            <div className="text-[10px] text-white/60 uppercase tracking-wider">{s.label}</div>
            <div className="text-sm font-bold leading-tight">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Speed legend */}
      <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 text-white z-10">
        <div className="text-[10px] text-white/60 uppercase tracking-wider mb-1.5">Velocità</div>
        <div
          className="w-24 h-2.5 rounded-full"
          style={{
            background: "linear-gradient(to right, #dc4444, #dbb308, #22c55e)",
          }}
        />
        <div className="flex justify-between text-[9px] text-white/50 mt-0.5">
          <span>lento</span>
          <span>veloce</span>
        </div>
      </div>

      {/* Controls */}
      {ready && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
          <div className="bg-black/65 backdrop-blur-sm rounded-full px-4 py-2 flex items-center gap-3">
            <button
              onClick={handleReset}
              className="text-white/70 hover:text-white transition-colors"
              title="Ricomincia"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </button>

            <button
              onClick={handlePlayPause}
              className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white hover:bg-primary/90 transition-colors"
              title={playing ? "Pausa" : "Riproduci"}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              )}
            </button>

            <div className="w-28 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-none"
                style={{ width: `${progress * 100}%` }}
              />
            </div>

            <span className="text-white/70 text-xs tabular-nums w-8">
              {Math.round(progress * 100)}%
            </span>
          </div>
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Caricamento mappa…
          </div>
        </div>
      )}
    </div>
  );
}
