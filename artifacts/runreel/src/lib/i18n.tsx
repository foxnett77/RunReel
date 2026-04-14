import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Lang = "it" | "en";

const T = {
  it: {
    nav_home: "Home",
    nav_activities: "Attività",
    nav_live: "Live",
    nav_upload: "Carica",
    lang_toggle: "EN",

    hero_subtitle: "La tua striscia di attività personali.",
    start_live: "Avvia Live",
    upload_gpx: "Carica GPX",
    stat_total_activities: "Attività totali",
    stat_total_distance: "Distanza totale",
    stat_total_time: "Tempo totale",
    stat_best_pace: "Miglior passo",
    recent_activities: "Attività recenti",
    view_all: "Vedi tutte",
    no_activities: "Nessuna attività ancora.",
    upload_first: "Carica il tuo primo GPX",

    activities_title: "Le tue attività",
    activities_search: "Cerca attività...",
    filter_all: "Tutti",
    activities_empty: "Nessuna attività. Carica un file GPX per iniziare.",
    activities_no_results: "Nessuna attività trovata",
    activities_no_results_hint: "Prova a modificare la ricerca o i filtri.",
    col_distance: "distanza",
    col_duration: "durata",
    col_pace: "passo",

    detail_distance: "Distanza",
    detail_duration: "Durata",
    detail_pace: "Passo medio",
    detail_elevation: "Dislivello",
    detail_elevation_profile: "Profilo altimetrico",
    detail_create_reel: "Crea Reel",
    detail_recording: "Registrazione…",
    detail_delete: "Elimina",
    detail_delete_confirm: "Eliminare questa attività?",
    detail_reel_ready: "Reel pronto!",
    detail_reel_subtitle: "Guarda l'anteprima e poi scarica o condividi.",
    detail_share: "Condividi",
    detail_download: "Scarica",
    detail_not_found: "Attività non trovata.",
    detail_rename: "Rinomina",
    detail_rename_placeholder: "Nome attività",
    detail_rename_save: "Salva",
    detail_rename_cancel: "Annulla",
    detail_photo_card: "Photo Card",

    quality_standard: "12s",
    quality_hd: "HD 15s",
    quality_label_standard: "Standard · 8 Mbps · 12 sec",
    quality_label_hd: "Alta qualità · 14 Mbps · 15 sec",

    upload_title: "Carica GPX",
    upload_drag: "Trascina qui il file GPX",
    upload_or: "oppure",
    upload_browse: "Seleziona file",
    upload_name_label: "Nome attività",
    upload_type_label: "Tipo",
    upload_submit: "Carica",
    upload_loading: "Caricamento…",
    upload_success: "Attività caricata con successo!",
    upload_error: "Errore durante il caricamento.",
    upload_invalid: "File non valido. Carica un file .gpx.",

    live_title: "Tracking Live",
    live_start: "Avvia Tracking",
    live_stop: "Ferma",
    live_running: "In corso",
    live_distance: "Distanza",
    live_duration: "Durata",
    live_pace: "Passo",

    type_running: "Corsa",
    type_cycling: "Ciclismo",
    type_hiking: "Escursione",
    type_other: "Altro",
  },
  en: {
    nav_home: "Home",
    nav_activities: "Activities",
    nav_live: "Live",
    nav_upload: "Upload",
    lang_toggle: "IT",

    hero_subtitle: "Your personal activity streak.",
    start_live: "Start Live",
    upload_gpx: "Upload GPX",
    stat_total_activities: "Total activities",
    stat_total_distance: "Total distance",
    stat_total_time: "Total time",
    stat_best_pace: "Best pace",
    recent_activities: "Recent activities",
    view_all: "View all",
    no_activities: "No activities yet.",
    upload_first: "Upload your first GPX",

    activities_title: "Your activities",
    activities_search: "Search activities...",
    filter_all: "All",
    activities_empty: "No activities. Upload a GPX file to get started.",
    activities_no_results: "No activities found",
    activities_no_results_hint: "Try adjusting your search or filters.",
    col_distance: "distance",
    col_duration: "duration",
    col_pace: "pace",

    detail_distance: "Distance",
    detail_duration: "Duration",
    detail_pace: "Avg pace",
    detail_elevation: "Elevation",
    detail_elevation_profile: "Elevation profile",
    detail_create_reel: "Create Reel",
    detail_recording: "Recording…",
    detail_delete: "Delete",
    detail_delete_confirm: "Delete this activity?",
    detail_reel_ready: "Reel ready!",
    detail_reel_subtitle: "Preview the video then download or share.",
    detail_share: "Share",
    detail_download: "Download",
    detail_not_found: "Activity not found.",
    detail_rename: "Rename",
    detail_rename_placeholder: "Activity name",
    detail_rename_save: "Save",
    detail_rename_cancel: "Cancel",
    detail_photo_card: "Photo Card",

    quality_standard: "12s",
    quality_hd: "HD 15s",
    quality_label_standard: "Standard · 8 Mbps · 12 sec",
    quality_label_hd: "High quality · 14 Mbps · 15 sec",

    upload_title: "Upload GPX",
    upload_drag: "Drag your GPX file here",
    upload_or: "or",
    upload_browse: "Select file",
    upload_name_label: "Activity name",
    upload_type_label: "Type",
    upload_submit: "Upload",
    upload_loading: "Uploading…",
    upload_success: "Activity uploaded successfully!",
    upload_error: "Upload failed.",
    upload_invalid: "Invalid file. Please upload a .gpx file.",

    live_title: "Live Tracking",
    live_start: "Start Tracking",
    live_stop: "Stop",
    live_running: "Running",
    live_distance: "Distance",
    live_duration: "Duration",
    live_pace: "Pace",

    type_running: "Running",
    type_cycling: "Cycling",
    type_hiking: "Hiking",
    type_other: "Other",
  },
} as const;

export type TranslationKey = keyof typeof T.it;

const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
}>({
  lang: "it",
  setLang: () => {},
  t: (k) => T.it[k],
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem("rr-lang") as Lang) ?? "it"; } catch { return "it"; }
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("rr-lang", l); } catch {}
  };

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = (key: TranslationKey) => T[lang][key] as string;

  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}
