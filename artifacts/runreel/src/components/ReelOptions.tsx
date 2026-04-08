import { useState, useMemo } from 'react';

export interface ReelOpts {
  style: '2d' | '3d';
  format: '9:16' | '16:9';
  duration: number;
  quality: 'standard' | 'hd';
}

interface Props {
  activityName: string;
  hasElevation: boolean;
  onStart: (opts: ReelOpts) => void;
  onCancel: () => void;
}

function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">{label}</p>
      <div className="flex gap-2">
        {options.map(o => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex flex-col items-center ${
              value === o.id
                ? 'bg-primary text-white shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <span>{o.label}</span>
            {o.sub && <span className={`text-[10px] mt-0.5 font-normal ${value === o.id ? 'text-white/75' : 'text-muted-foreground/70'}`}>{o.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReelOptions({ activityName, hasElevation, onStart, onCancel }: Props) {
  const [style, setStyle]     = useState<'2d' | '3d'>('2d');
  const [format, setFormat]   = useState<'9:16' | '16:9'>('9:16');
  const [duration, setDuration] = useState(20);
  const [quality, setQuality] = useState<'standard' | 'hd'>('standard');

  const canRecord = useMemo(() => (
    typeof MediaRecorder !== 'undefined' &&
    typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === 'function'
  ), []);

  const handleStart = () => onStart({ style, format, duration, quality });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-background w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <h2 className="text-xl font-black">Crea Reel</h2>
            <p className="text-xs text-muted-foreground truncate max-w-[240px] mt-0.5">{activityName}</p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="px-6 pb-6 space-y-5 overflow-y-auto">

          {/* ── Stile ──────────────────────────────── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Stile</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                {
                  id: '2d' as const,
                  icon: (
                    <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7 mb-1.5">
                      <rect width="40" height="28" rx="6" fill="#1e293b"/>
                      <path d="M5 20 L11 13 L17 17 L23 10 L35 18" stroke="#E11D48" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <rect x="0" y="0" width="40" height="28" rx="6" stroke="#334155" strokeWidth="1" fill="none"/>
                    </svg>
                  ),
                  title: '2D Cinematico',
                  sub: 'Mappa prospettica · alta compatibilità',
                },
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setStyle(opt.id)}
                  className={`text-left p-3.5 rounded-2xl border-2 transition-all ${
                    style === opt.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-muted/20 hover:border-muted-foreground/30'
                  }`}
                >
                  {opt.icon}
                  <div className="font-bold text-sm">{opt.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.sub}</div>
                </button>
              ))}

              {/* 3D — prossimamente */}
              <div className="relative text-left p-3.5 rounded-2xl border-2 border-border bg-muted/10 opacity-50 cursor-not-allowed select-none">
                <svg viewBox="0 0 40 28" fill="none" className="w-10 h-7 mb-1.5">
                  <rect width="40" height="28" rx="6" fill="#1e293b"/>
                  <ellipse cx="20" cy="14" rx="12" ry="10" fill="#1e3a5f"/>
                  <ellipse cx="20" cy="14" rx="12" ry="5" stroke="#3b82f6" strokeWidth="1" fill="none"/>
                  <line x1="8" y1="14" x2="32" y2="14" stroke="#3b82f6" strokeWidth="0.8"/>
                  <path d="M12 19 Q20 5 28 19" stroke="#22c55e" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  <circle cx="20" cy="9" r="2" fill="#E11D48"/>
                  <rect x="0" y="0" width="40" height="28" rx="6" stroke="#334155" strokeWidth="1" fill="none"/>
                </svg>
                <div className="font-bold text-sm">3D Terrain</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">CesiumJS · rilievo reale</div>
                <span className="absolute top-2 right-2 text-[10px] font-bold bg-zinc-700 text-zinc-200 px-1.5 py-0.5 rounded-full">Prossimamente</span>
              </div>
            </div>
          </div>

          {/* ── Formato ──────────────────────────────── */}
          <PillGroup
            label="Formato"
            value={format}
            onChange={setFormat}
            options={[
              { id: '9:16', label: '9:16', sub: 'Verticale (Stories/Reel)' },
              { id: '16:9', label: '16:9', sub: 'Orizzontale (YouTube/TV)' },
            ]}
          />

          {/* ── Durata ──────────────────────────────── */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5">Durata</p>
            <div className="flex gap-2">
              {([12, 20, 30] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex flex-col items-center ${
                    duration === d ? 'bg-primary text-white shadow-sm' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <span>{d}s</span>
                  <span className={`text-[10px] mt-0.5 font-normal ${duration === d ? 'text-white/75' : 'text-muted-foreground/70'}`}>
                    {d === 12 ? 'Corto' : d === 20 ? 'Standard' : 'Lungo'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Qualità ──────────────────────────────── */}
          <PillGroup
            label="Qualità"
            value={quality}
            onChange={setQuality}
            options={[
              { id: 'standard', label: 'Standard', sub: '8 Mbps' },
              { id: 'hd', label: 'HD', sub: '16 Mbps' },
            ]}
          />

          {/* Avviso iOS */}
          {!canRecord && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Registrazione non supportata</p>
              <p className="text-[12px] text-amber-700 leading-relaxed">
                iOS Safari non supporta la registrazione diretta del canvas. Potrai visualizzare la
                scena e usare la Registrazione Schermo del Centro di Controllo.
              </p>
            </div>
          )}

          {/* Riepilogo + CTA */}
          <div className="pt-1">
            <p className="text-[11px] text-center text-muted-foreground mb-3">
              {style === '3d' ? '3D Terrain' : '2D Cinematico'} · {format} · {duration}s · {quality === 'hd' ? '16 Mbps' : '8 Mbps'}
            </p>
            <button
              onClick={handleStart}
              className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-base hover:bg-primary/90 active:scale-[0.98] transition-all"
            >
              {canRecord ? 'Genera Reel' : 'Visualizza Reel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
