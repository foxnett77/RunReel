import { useState } from "react";
import { Link } from "wouter";
import { useListActivities, useDeleteActivity } from "@workspace/api-client-react";
import { formatDuration, formatDistance, formatPace, formatDate, activityTypeLabel } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getListActivitiesQueryKey, getGetStatsSummaryQueryKey } from "@workspace/api-client-react";
import { useLang } from "@/lib/i18n";
import StravaPanel from "@/components/StravaPanel";

const TYPES = ["tutti", "run", "walk", "bike", "hike", "other"];

export default function Activities() {
  const { data: activities, isLoading } = useListActivities();
  const deleteMutation = useDeleteActivity();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("tutti");
  const [search, setSearch] = useState("");
  const { t: tr } = useLang();

  const filtered = (activities ?? []).filter((a) => {
    const matchType = filter === "tutti" || a.type === filter;
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Eliminare questa attivita?")) return;
    await deleteMutation.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black">{tr("activities_title")}</h1>
        <Link href="/upload">
          <span className="px-4 py-2 bg-primary text-white rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors cursor-pointer">
            {tr("upload_gpx")}
          </span>
        </Link>
      </div>

      {/* Strava integration panel */}
      <div className="mb-6">
        <StravaPanel onSynced={() => {
          queryClient.invalidateQueries({ queryKey: getListActivitiesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetStatsSummaryQueryKey() });
        }} />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="search"
          placeholder={tr("activities_search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex gap-2 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${
                filter === t
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {t === "tutti" ? tr("filter_all") : activityTypeLabel(t)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="bg-muted rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-muted/30 rounded-xl border border-dashed border-border">
          <div className="text-4xl mb-3">🏃</div>
          <p className="font-semibold text-foreground mb-1">{tr("activities_no_results")}</p>
          <p className="text-sm text-muted-foreground">{tr("activities_no_results_hint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((act) => (
            <Link key={act.id} href={`/activities/${act.id}`}>
              <div className="bg-white rounded-xl border border-border p-4 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-lg flex-shrink-0">
                  {act.type === "run" ? "🏃" : act.type === "bike" ? "🚴" : act.type === "walk" ? "🚶" : act.type === "hike" ? "🥾" : "⚡"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-foreground truncate">{act.name}</div>
                  <div className="text-xs text-muted-foreground">{formatDate(act.date)} · {activityTypeLabel(act.type)}</div>
                </div>
                <div className="hidden sm:flex gap-6 text-sm">
                  <div className="text-right">
                    <div className="font-bold text-foreground">{formatDistance(act.distanceKm)}</div>
                    <div className="text-xs text-muted-foreground">{tr("col_distance")}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-foreground">{formatDuration(act.durationSecs)}</div>
                    <div className="text-xs text-muted-foreground">{tr("col_duration")}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-foreground">{formatPace(act.avgPaceSecPerKm ?? 0)}/km</div>
                    <div className="text-xs text-muted-foreground">{tr("col_pace")}</div>
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(act.id, e)}
                  className="ml-2 text-muted-foreground hover:text-destructive transition-colors p-1 rounded flex-shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                  </svg>
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
