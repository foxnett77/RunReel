# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## RunReel App

A PWA (Progressive Web App) for GPS activity tracking and social video creation.

### Features
- **GPX Upload**: Drag-and-drop GPX files, parsed client-side with DOMParser
- **Interactive Maps**: Leaflet (react-leaflet) for displaying routes
- **Live Tracking**: Real-time GPS tracking via Geolocation API
- **Reel Creator**: Canvas API + MediaRecorder to generate animated WebM videos
- **Offline Support**: Service Worker at `/public/sw.js`, OpenStreetMap tile caching
- **PWA**: Installable with manifest.json

### Routes
- `/` — Home/Dashboard with stats and recent activities
- `/activities` — Full activity list with filter/search
- `/activities/:id` — Activity detail with map, elevation, and Reel creator
- `/live` — Live GPS tracking with real-time stats
- `/upload` — GPX file upload and parsing

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
- **Maps**: Leaflet

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
