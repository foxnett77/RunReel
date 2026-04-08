# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## RunReel App

A PWA (Progressive Web App) for GPS activity tracking and social video creation.

### Features (v0.39)
- **GPX Upload**: Drag-and-drop GPX files, parsed client-side with DOMParser
- **Interactive Maps**: Leaflet (react-leaflet) for displaying routes; MapLibre GL for the 3D animated preview (`AnimatedMap3D`)
- **Live Tracking**: Real-time GPS tracking via Geolocation API
- **Reel Creator**: Full options page before generation with 4 settings:
  - **Stile**: 2D Cinematico (canvas + MediaRecorder) / 3D Terrain (CesiumJS)
  - **Formato**: 9:16 verticale (1080×1920) / 16:9 orizzontale (1920×1080)
  - **Durata**: 12s / 20s / 30s
  - **Qualità**: Standard 8 Mbps / HD 16 Mbps
  - iOS Safari detection: shows warning + screen-recording tip when `captureStream` is unavailable
  - Perspective warp (300 horizontal strips), synthesized beat music via Web Audio API
  - `drawStats` scales proportionally to available panel height in any format
  - MediaRecorder setup: webm-first mimeType chain, try-catch on captureStream/init/start, 200ms timeslice
- **CesiumJS 3D Reel**: ArcGIS terrain, CartoCDN imagery, drone camera, animated runner
  - `canRecordStream` detection: falls back to view-only mode on iOS (no crash)
  - Respects quality bitrate from options
- **Activity Rename**: Inline rename via PATCH `/api/activities/:id` (hover pencil icon)
- **i18n**: IT/EN toggle stored in localStorage, toggle in navbar
- **Offline Support**: Service Worker `runreel-v39` cache
- **PWA**: Installable with manifest.json

### Bug fixes (v0.39)
- `AnimatedMap3D`: `t` clamped to `[0, 1]` in both tick functions; guard for `i === 0` in `getPartialGeoJSON` prevents undefined-property crash on first animation frame
- 2D reel: preload cache bypassed when format ≠ 9:16 (avoids coordinate mismatch)
- MediaRecorder mimeType priority: `video/webm;codecs=vp9` → `vp8` → `webm` → `mp4` (was mp4-first, broke on some browsers)

### Routes
- `/` — Home/Dashboard with stats and recent activities
- `/activities` — Full activity list with filter/search
- `/activities/:id` — Activity detail with map, elevation, and Reel creator
- `/live` — Live GPS tracking with real-time stats
- `/upload` — GPX file upload and parsing

### Key Components
- `ReelOptions.tsx` — bottom-sheet options modal, capability-detects iOS
- `ActivityDetail.tsx` — handles full reel flow: options → 2D canvas or 3D CesiumReel
- `CesiumReel.tsx` — 3D reel with `canRecordStream` guard
- `AnimatedMap3D.tsx` — interactive 3D animated route preview (MapLibre)

### Brand
- Colors: Red (#E11D48) and white
- Font: Inter

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite (artifact: runreel)
- **Maps**: Leaflet, MapLibre GL, CesiumJS

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
