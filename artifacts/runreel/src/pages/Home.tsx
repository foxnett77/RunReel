import { Link } from "wouter";
import { useListActivities, useGetStatsSummary } from "@workspace/api-client-react";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-black text-foreground">{value}</div>
    </div>
  );
}

export default function Home() {
  const { data: activities, isLoading: loadingActs } = useListActivities();
  const { data: stats, isLoading: loadingStats } = useGetStatsSummary();

  const recent = activities?.slice(0, 5) ?? [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="brand-gradient rounded-2xl p-8 text-white mb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, white 0, white 1px, transparent 0, transparent 50%)", backgroundSize: "16px 16px" }}
        />
        <div className="relative">
          <h1 className="text-4xl font-black mb-2">RunReel</h1>
          <p className="text-white/80 text-lg mb-6">La tua striscia di attivita personali.</p>
          <div className="flex gap-3 flex-wrap">
            <Link href="/live">
              <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-primary rounded-lg font-bold text-sm hover:bg-white/90 transition-colors cursor-pointer">
                Avvia Live
              </span>
            </Link>
            <Link href="/upload">
              <span className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/20 text-white rounded-lg font-bold text-sm hover:bg-white/30 transition-colors cursor-pointer border border-white/30">
                Carica GPX
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      {loadingStats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-muted rounded-xl h-24 animate-pulse" />
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Attivita totali" value={String(stats.totalActivities)} />
          <StatCard label="Distanza totale" value={formatDistance(stats.totalDistanceKm)} />
          <StatCard label="Tempo totale" value={formatDuration(stats.totalDurationSecs)} />
          <StatCard label="Miglior passo" value={formatPace(stats.bestPaceSecPerKm ?? 0) + " /km"} />
        </div>
      ) : null}

      {/* Recent activities */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Attivita recenti</h2>
          <Link href="/activities">
            <span className="text-sm text-primary font-semibold hover:underline cursor-pointer">Vedi tutte</span>
          </Link>
        </div>

        {loadingActs ? (
          <div className="space-y-3">
            {[1,2,3].map(i => (
              <div key={i} className="bg-muted rounded-xl h-20 animate-pulse" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="text-center py-16 bg-muted/30 rounded-xl border border-dashed border-border">
            <div className="text-4xl mb-3">🏃</div>
            <p className="font-semibold text-foreground mb-1">Nessuna attivita ancora</p>
            <p className="text-sm text-muted-foreground">Carica un file GPX o avvia il tracciamento live per iniziare.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recent.map((act) => (
              <Link key={act.id} href={`/activities/${act.id}`}>
                <div className="bg-white rounded-xl border border-border p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">
                    {act.type === "run" ? "🏃" : act.type === "bike" ? "🚴" : act.type === "walk" ? "🚶" : act.type === "hike" ? "🥾" : "⚡"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-foreground truncate">{act.name}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(act.date)} · {activityTypeLabel(act.type)}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-foreground">{formatDistance(act.distanceKm)}</div>
                    <div className="text-xs text-muted-foreground">{formatDuration(act.durationSecs)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
