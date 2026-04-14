import { useRef, useState, useCallback, useEffect } from "react";
import { formatDuration, formatDistance, formatPace } from "@/lib/utils";

interface Point { lat: number; lon: number; ele?: number }

interface Props {
  activity: {
    name: string;
    date: string;
    distanceKm?: number | null;
    durationSecs?: number | null;
    avgPaceSecPerKm?: number | null;
    elevationGainM?: number | null;
  };
  points: Point[];
  onClose: () => void;
}

type Format = "square" | "story" | "landscape";

const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  square:    { w: 1080, h: 1080, label: "1:1 Quadrato" },
  story:     { w: 1080, h: 1920, label: "9:16 Storia" },
  landscape: { w: 1920, h: 1080, label: "16:9 Landscape" },
};

const TRACK_COLORS = [
  { id: "orange", label: "Arancio", stroke: "#FF6B35", glow: "rgba(255,107,53,0.5)" },
  { id: "cyan",   label: "Ciano",   stroke: "#00D4FF", glow: "rgba(0,212,255,0.5)" },
  { id: "green",  label: "Verde",   stroke: "#4ADE80", glow: "rgba(74,222,128,0.5)" },
  { id: "white",  label: "Bianco",  stroke: "#FFFFFF", glow: "rgba(255,255,255,0.4)" },
];

function projectPoints(
  pts: Point[],
  canvasW: number,
  canvasH: number,
  areaX: number,
  areaY: number,
  areaW: number,
  areaH: number,
  padding = 40
): Array<{ x: number; y: number }> {
  if (pts.length === 0) return [];
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const dLat = maxLat - minLat || 1e-5;
  const dLon = maxLon - minLon || 1e-5;
  const innerW = areaW - padding * 2;
  const innerH = areaH - padding * 2;
  const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const scaleX = innerW / (dLon * cosLat);
  const scaleY = innerH / dLat;
  const scale = Math.min(scaleX, scaleY);
  const projW = dLon * cosLat * scale;
  const projH = dLat * scale;
  const offX = areaX + padding + (innerW - projW) / 2;
  const offY = areaY + padding + (innerH - projH) / 2;
  return pts.map((p) => ({
    x: offX + (p.lon - minLon) * cosLat * scale,
    y: offY + (maxLat - p.lat) * scale,
  }));
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  photo: HTMLImageElement | null,
  points: Point[],
  activity: Props["activity"],
  format: Format,
  colorId: string,
  overlayOpacity: number
) {
  const { w, h } = FORMATS[format];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const color = TRACK_COLORS.find((c) => c.id === colorId) ?? TRACK_COLORS[0];

  // 1. Background
  if (photo) {
    const photoRatio = photo.naturalWidth / photo.naturalHeight;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = photo.naturalWidth, sh = photo.naturalHeight;
    if (photoRatio > canvasRatio) {
      sw = photo.naturalHeight * canvasRatio;
      sx = (photo.naturalWidth - sw) / 2;
    } else {
      sh = photo.naturalWidth / canvasRatio;
      sy = (photo.naturalHeight - sh) / 2;
    }
    ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);
  }

  // 2. Dark overlay
  const alpha = overlayOpacity / 100;
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, w, h);

  // 3. Stats panel area (bottom 35% for story, 40% for others)
  const statsH = h * (format === "story" ? 0.30 : 0.38);
  const statsY = h - statsH;

  // Gradient for stats panel
  const grad = ctx.createLinearGradient(0, statsY - statsH * 0.3, 0, h);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.4, "rgba(0,0,0,0.75)");
  grad.addColorStop(1, "rgba(0,0,0,0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, statsY - statsH * 0.3, w, statsH * 1.3);

  // 4. Track area (avoid stats panel)
  const trackAreaH = statsY - 20;
  const trackArea = { x: 0, y: 0, w, h: trackAreaH };

  if (points.length > 1) {
    const projected = projectPoints(
      points,
      w,
      h,
      trackArea.x,
      trackArea.y,
      trackArea.w,
      trackArea.h,
      w * 0.07
    );

    // Glow pass
    ctx.save();
    ctx.strokeStyle = color.glow;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.filter = "blur(8px)";
    ctx.beginPath();
    projected.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Main track
    ctx.save();
    ctx.strokeStyle = color.stroke;
    ctx.lineWidth = Math.max(4, w * 0.004);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    projected.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Start dot (green)
    const start = projected[0];
    ctx.save();
    ctx.beginPath();
    ctx.arc(start.x, start.y, Math.max(8, w * 0.009), 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e";
    ctx.shadowColor = "rgba(34,197,94,0.7)";
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // End dot (red)
    const end = projected[projected.length - 1];
    ctx.save();
    ctx.beginPath();
    ctx.arc(end.x, end.y, Math.max(8, w * 0.009), 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.shadowColor = "rgba(239,68,68,0.7)";
    ctx.shadowBlur = 16;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // 5. Stats text
  const pad = w * 0.065;
  const baseSize = w * 0.038;
  const labelSize = w * 0.022;

  ctx.save();

  // Activity name
  ctx.font = `900 ${baseSize * 1.1}px 'Inter', system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 8;
  const nameY = statsY + baseSize * 1.2;
  ctx.fillText(
    activity.name.length > 40 ? activity.name.slice(0, 38) + "…" : activity.name,
    pad,
    nameY
  );

  // Date
  ctx.font = `400 ${labelSize * 1.1}px 'Inter', system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillText(activity.date, pad, nameY + labelSize * 2.2);

  // Stats grid
  const stats = [
    { label: "Distanza",   value: activity.distanceKm != null ? formatDistance(activity.distanceKm) : "—" },
    { label: "Durata",     value: activity.durationSecs != null ? formatDuration(activity.durationSecs) : "—" },
    { label: "Passo medio",value: activity.avgPaceSecPerKm != null ? formatPace(activity.avgPaceSecPerKm) : "—" },
    { label: "Dislivello", value: activity.elevationGainM != null ? `${Math.round(activity.elevationGainM)} m` : "—" },
  ];

  const gridY = h - pad - baseSize * 2.2;
  const colW = (w - pad * 2) / stats.length;

  stats.forEach((s, i) => {
    const cx = pad + i * colW;
    ctx.font = `700 ${baseSize * 1.05}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 4;
    ctx.fillText(s.value, cx, gridY);
    ctx.font = `400 ${labelSize}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(s.label.toUpperCase(), cx, gridY + labelSize * 1.8);
  });

  // Brand watermark
  ctx.font = `900 ${labelSize * 1.3}px 'Inter', system-ui, sans-serif`;
  ctx.fillStyle = color.stroke;
  ctx.shadowColor = color.glow;
  ctx.shadowBlur = 10;
  const brand = "RunReel";
  const bw = ctx.measureText(brand).width;
  ctx.fillText(brand, w - bw - pad * 0.7, pad * 1.1);

  ctx.restore();
}

export default function PhotoOverlay({ activity, points, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("story");
  const [colorId, setColorId] = useState("orange");
  const [opacity, setOpacity] = useState(45);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const redraw = useCallback(() => {
    if (!canvasRef.current) return;
    drawCanvas(
      canvasRef.current,
      photoRef.current,
      points,
      activity,
      format,
      colorId,
      opacity
    );
    setPreviewUrl(canvasRef.current.toDataURL("image/jpeg", 0.92));
  }, [activity, points, format, colorId, opacity]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const loadPhoto = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      photoRef.current = img;
      setPhoto(url);
      redraw();
    };
    img.src = url;
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadPhoto(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) loadPhoto(file);
  };

  const handleDownload = () => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.href = canvasRef.current.toDataURL("image/jpeg", 0.95);
    link.download = `runreel-${activity.name.replace(/\s+/g, "-")}.jpg`;
    link.click();
  };

  const handleShare = async () => {
    if (!canvasRef.current || !navigator.share) { handleDownload(); return; }
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.share({
          files: [new File([blob], "runreel.jpg", { type: "image/jpeg" })],
          title: activity.name,
        });
      } catch { handleDownload(); }
    }, "image/jpeg", 0.92);
  };

  const canShare = typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto overscroll-none"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-end sm:items-center justify-center sm:p-4">
      <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full max-w-3xl shadow-2xl">
        {/* Header — sticky so sempre visibile */}
        <div className="sticky top-0 z-10 bg-card flex items-center justify-between px-5 py-4 border-b border-border rounded-t-2xl sm:rounded-t-2xl">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <span className="font-bold text-base">Photo Card</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-0">
          {/* Controls */}
          <div className="md:w-64 p-5 border-b md:border-b-0 md:border-r border-border flex flex-col gap-5 order-2 md:order-1">
            {/* Photo upload */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                Foto di sfondo
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                className={`relative border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer ${isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                onClick={() => document.getElementById("photo-input")?.click()}
              >
                {photo ? (
                  <div className="flex items-center gap-2">
                    <img src={photo} alt="" className="w-10 h-10 rounded object-cover" />
                    <span className="text-xs text-muted-foreground">Cambia foto</span>
                  </div>
                ) : (
                  <div className="py-2">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-1 text-muted-foreground">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    <p className="text-xs text-muted-foreground">Trascina o clicca</p>
                  </div>
                )}
                <input id="photo-input" type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </div>
            </div>

            {/* Format */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                Formato
              </label>
              <div className="flex flex-col gap-1.5">
                {(Object.keys(FORMATS) as Format[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`px-3 py-2 rounded-lg text-sm text-left transition-colors ${format === f ? "bg-primary text-white font-semibold" : "bg-muted hover:bg-muted/80 text-foreground"}`}
                  >
                    {FORMATS[f].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Track color */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">
                Colore traccia
              </label>
              <div className="flex gap-2 flex-wrap">
                {TRACK_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setColorId(c.id)}
                    title={c.label}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${colorId === c.id ? "border-white scale-110 shadow-lg" : "border-transparent"}`}
                    style={{ background: c.stroke }}
                  />
                ))}
              </div>
            </div>

            {/* Overlay opacity */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex justify-between">
                <span>Oscuramento foto</span>
                <span className="text-foreground">{opacity}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={80}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 mt-auto">
              <button
                onClick={handleDownload}
                className="w-full px-4 py-2.5 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Scarica JPG
              </button>
              {canShare && (
                <button
                  onClick={handleShare}
                  className="w-full px-4 py-2.5 bg-muted text-foreground rounded-lg text-sm font-semibold hover:bg-muted/80 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                  Condividi
                </button>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 p-5 flex flex-col items-center justify-center bg-muted/30 rounded-b-2xl md:rounded-r-2xl md:rounded-bl-none order-1 md:order-2">
            <p className="text-xs text-muted-foreground mb-3">Anteprima</p>
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Preview"
                className="rounded-xl shadow-xl max-w-full max-h-[40vh] sm:max-h-[60vh] object-contain"
                style={{ aspectRatio: `${FORMATS[format].w}/${FORMATS[format].h}` }}
              />
            ) : (
              <div className="w-48 h-48 rounded-xl bg-muted flex items-center justify-center text-muted-foreground text-sm">
                Caricamento…
              </div>
            )}
            {!photo && (
              <p className="text-xs text-muted-foreground mt-3">
                Carica una foto per personalizzare lo sfondo
              </p>
            )}
          </div>
        </div>

        {/* Hidden canvas for rendering */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
      </div>
    </div>
  );
}
