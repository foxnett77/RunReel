import { useEffect, useRef, useState } from 'react';

type Point = { lat: number; lon: number; ele?: number };

interface ActivityInfo {
  name: string;
  distanceKm: number | null;
  durationSecs: number | null;
  avgPaceSecPerKm: number | null;
  elevationGainM: number | null;
}

interface CesiumReelProps {
  points: Point[];
  activity: ActivityInfo;
  reelDuration: number;
  onComplete: (url: string, ext: string) => void;
  onCancel: () => void;
}

export default function CesiumReel({ points, activity, reelDuration, onComplete, onCancel }: CesiumReelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'init' | 'flyto' | 'rec' | 'done'>('init');
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!containerRef.current || points.length < 2) return;

    let destroyed = false;
    let rafId = 0;
    let cesiumViewer: import('cesium').Viewer | null = null;
    let mediaRecorder: MediaRecorder | null = null;

    const run = async () => {
      const C = await import('cesium');
      await import('cesium/Build/Cesium/Widgets/widgets.css');

      if (destroyed) return;

      let terrain: import('cesium').Terrain;
      try {
        terrain = new C.Terrain(
          C.ArcGISTiledElevationTerrainProvider.fromUrl(
            'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
          )
        );
      } catch {
        terrain = new C.Terrain(Promise.resolve(new C.EllipsoidTerrainProvider()));
      }

      cesiumViewer = new C.Viewer(containerRef.current!, {
        terrain,
        baseLayer: false,
        baseLayerPicker: false,
        timeline: false,
        animation: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        geocoder: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        requestRenderMode: false,
        contextOptions: {
          requestWebgl2: true,
          webgl: { preserveDrawingBuffer: true },
        },
      });

      cesiumViewer.imageryLayers.addImageryProvider(
        new C.UrlTemplateImageryProvider({
          url: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          credit: '© CartoDB © OpenStreetMap',
          maximumLevel: 19,
        })
      );

      if (destroyed) { cesiumViewer.destroy(); return; }

      const hasEle = points.some(p => (p.ele ?? 0) > 0);
      const LIFT = 3;

      const toCart = (p: Point) =>
        C.Cartesian3.fromDegrees(p.lon, p.lat, hasEle ? (p.ele! + LIFT) : LIFT);

      const positions = points.map(toCart);

      cesiumViewer.entities.add({
        polyline: {
          positions,
          width: 6,
          material: new C.PolylineGlowMaterialProperty({
            glowPower: 0.28,
            color: C.Color.fromCssColorString('#E11D48'),
          }),
          clampToGround: false,
        },
      });

      cesiumViewer.entities.add({
        position: positions[0],
        point: {
          pixelSize: 14,
          color: C.Color.fromCssColorString('#22c55e'),
          outlineColor: C.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      cesiumViewer.entities.add({
        position: positions[positions.length - 1],
        point: {
          pixelSize: 14,
          color: C.Color.fromCssColorString('#E11D48'),
          outlineColor: C.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      const start = C.JulianDate.fromDate(new Date());
      const stop = C.JulianDate.addSeconds(start, reelDuration, new C.JulianDate());
      const clock = cesiumViewer.clock;
      clock.startTime = start.clone();
      clock.stopTime = stop.clone();
      clock.currentTime = start.clone();
      clock.clockRange = C.ClockRange.CLAMPED;
      clock.multiplier = 1;
      clock.shouldAnimate = false;

      const positionProp = new C.SampledPositionProperty();
      points.forEach((p, i) => {
        const t = C.JulianDate.addSeconds(
          start,
          (i / (points.length - 1)) * reelDuration,
          new C.JulianDate()
        );
        positionProp.addSample(t, toCart(p));
      });
      positionProp.setInterpolationOptions({
        interpolationDegree: 3,
        interpolationAlgorithm: C.HermitePolynomialApproximation,
      });

      const label = activity.name.length > 24 ? activity.name.slice(0, 24) + '…' : activity.name;

      const runner = cesiumViewer.entities.add({
        availability: new C.TimeIntervalCollection([new C.TimeInterval({ start, stop })]),
        position: positionProp,
        orientation: new C.VelocityOrientationProperty(positionProp),
        viewFrom: new C.ConstantProperty(new C.Cartesian3(-200, 0, 80)),
        point: {
          pixelSize: 22,
          color: C.Color.fromCssColorString('#E11D48'),
          outlineColor: C.Color.WHITE,
          outlineWidth: 4,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: label,
          font: 'bold 15px system-ui, sans-serif',
          style: C.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 3,
          outlineColor: C.Color.BLACK,
          fillColor: C.Color.WHITE,
          verticalOrigin: C.VerticalOrigin.BOTTOM,
          pixelOffset: new C.Cartesian2(0, -32),
          showBackground: true,
          backgroundColor: C.Color.fromCssColorString('#E11D48').withAlpha(0.85),
          backgroundPadding: new C.Cartesian2(10, 5),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });

      setPhase('flyto');
      await cesiumViewer.flyTo(cesiumViewer.entities, {
        duration: 3,
        offset: new C.HeadingPitchRange(0, C.Math.toRadians(-45), 1500),
      });

      if (destroyed) { cesiumViewer.destroy(); return; }

      cesiumViewer.trackedEntity = runner;
      setPhase('rec');
      clock.shouldAnimate = true;

      const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
        ? 'video/webm; codecs=vp9'
        : 'video/webm';
      const stream = cesiumViewer.canvas.captureStream(30);
      mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        if (destroyed) return;
        const blob = new Blob(chunks, { type: mimeType });
        onComplete(URL.createObjectURL(blob), 'webm');
        setPhase('done');
      };
      mediaRecorder.start(200);

      const tick = () => {
        if (destroyed || !cesiumViewer) return;
        const elapsed = C.JulianDate.secondsDifference(cesiumViewer.clock.currentTime, start);
        const p = Math.min(1, elapsed / reelDuration);
        setPct(p);
        if (p >= 1) { mediaRecorder?.stop(); return; }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    run().catch(err => console.error('CesiumReel:', err));

    return () => {
      destroyed = true;
      cancelAnimationFrame(rafId);
      if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
      cesiumViewer?.destroy();
    };
  }, []);

  const phaseLabel: Record<typeof phase, string> = {
    init: 'Caricamento terreno 3D…',
    flyto: 'Panoramica percorso…',
    rec: `● REC  ${Math.round(pct * 100)}%`,
    done: '✓ Completato',
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black select-none">
      <div ref={containerRef} className="flex-1 w-full" />

      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <span className={`text-sm font-bold px-3 py-1.5 rounded-lg pointer-events-none ${
          phase === 'rec' ? 'bg-red-600 text-white' : 'bg-black/70 text-white'
        }`}>
          {phaseLabel[phase]}
        </span>
        {phase !== 'done' && (
          <button
            onClick={onCancel}
            className="pointer-events-auto text-white bg-black/70 hover:bg-black/90 px-3 py-1.5 rounded-lg text-sm font-medium"
          >
            ✕ Annulla
          </button>
        )}
      </div>

      {(phase === 'rec' || phase === 'done') && (
        <div className="absolute bottom-6 left-4 right-4 flex gap-2 justify-center pointer-events-none">
          {[
            { v: activity.distanceKm != null ? `${activity.distanceKm.toFixed(2)} km` : '—', l: 'distanza' },
            { v: activity.elevationGainM != null ? `+${Math.round(activity.elevationGainM)} m` : '—', l: 'dislivello' },
          ].map(s => (
            <div key={s.l} className="bg-black/70 text-white rounded-lg px-4 py-2 text-center min-w-[90px]">
              <div className="font-bold text-sm">{s.v}</div>
              <div className="text-[10px] text-white/60 uppercase tracking-wide">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
        <div
          className="h-full bg-red-500"
          style={{ width: `${pct * 100}%`, transition: 'width 0.2s linear' }}
        />
      </div>
    </div>
  );
}
