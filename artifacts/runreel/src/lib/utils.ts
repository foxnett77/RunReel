import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return "--:--";
  const mins = Math.floor(secPerKm / 60);
  const secs = secPerKm % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatDuration(secs: number): string {
  if (!secs || secs <= 0) return "0:00:00";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatDistance(km: number): string {
  if (!km || km <= 0) return "0.00 km";
  return `${km.toFixed(2)} km`;
}

export function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function activityTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    run: "Corsa",
    walk: "Camminata",
    bike: "Bicicletta",
    hike: "Escursione",
    other: "Altro",
  };
  return labels[type] ?? type;
}

