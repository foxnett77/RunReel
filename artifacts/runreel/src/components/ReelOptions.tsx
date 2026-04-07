import { useState, useMemo } from 'react';

export interface ReelOpts {
  style: '2d' | '3d';
  duration: number;
}

interface Props {
  activityName: string;
  hasElevation: boolean;
  onStart: (opts: ReelOpts) => void;
  onCancel: () => void;
}

export default function ReelOptions({ activityName, hasElevation, onStart, onCancel }: Props) {
  const [style, setStyle] = useState<'2d' | '3d'>(hasElevation ? '3d' : '2d');
  const [duration, setDuration] = useState(20);

  const canRecord = useMemo(() => {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream === 'function'
    );
  }, []);

  const styles = [
    {
      id: '2d' as const,
      icon: (
        <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mb-2">
          <rect width="40" height="40" rx="10" fill="#0f172a"/>
          <rect x="4" y="10" width="32" height="20" rx="3" fill="#1e293b"/>
          <path d="M8 25 L14 17 L20 21 L26 14 L32 22" stroke="#E11D48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      title: '2D Cinematico',
      sub: 'Mappa prospettica animata · alta compatibilità',
    },
    {
      id: '3d' as const,
      icon: (
        <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mb-2">
          <rect width="40" height="40" rx="10" fill="#0f172a"/>
          <ellipse cx="20" cy="20" rx="13" ry="13" fill="#1e3a5f"/>
          <ellipse cx="20" cy="20" rx="13" ry="7" stroke="#3b82f6" strokeWidth="1.5" fill="none"/>
          <line x1="7" y1="20" x2="33" y2="20" stroke="#3b82f6" strokeWidth="1"/>
          <path d="M13 26 Q20 8 27 26" stroke="#22c55e" strokeWidth="2" fill="none" strokeLinecap="round"/>
          <circle cx="20" cy="14" r="2.5" fill="#E11D48"/>
        </svg>
      ),
      title: '3D Terrain',
      sub: 'Scena 3D CesiumJS con rilievo reale',
    },
  ] as const;

  const durations = [12, 20, 30];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-background w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
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

        <div className="px-6 pb-6 space-y-6">
          {/* Stile */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Stile</p>
            <div className="grid grid-cols-2 gap-3">
              {styles.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setStyle(opt.id)}
                  className={`text-left p-4 rounded-2xl border-2 transition-all ${
                    style === opt.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-muted/20 hover:border-muted-foreground/30'
                  }`}
                >
                  {opt.icon}
                  <div className="font-bold text-sm">{opt.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 leading-snug">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Durata */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Durata</p>
            <div className="flex gap-2">
              {durations.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${
                    duration === d
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          {/* Avviso compatibilità iOS */}
          {!canRecord && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Registrazione non supportata</p>
              <p className="text-[12px] text-amber-700 leading-relaxed">
                Il tuo browser (iOS Safari) non supporta la registrazione diretta. Puoi
                visualizzare la scena e registrare lo schermo con la funzione nativa del dispositivo.
              </p>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => onStart({ style, duration })}
            className="w-full py-4 bg-primary text-white rounded-2xl font-bold text-base hover:bg-primary/90 active:scale-[0.98] transition-all"
          >
            {canRecord
              ? `Genera Reel ${style === '3d' ? '3D' : '2D'} · ${duration}s`
              : `Visualizza ${style === '3d' ? '3D' : '2D'} · ${duration}s`}
          </button>
        </div>
      </div>
    </div>
  );
}
