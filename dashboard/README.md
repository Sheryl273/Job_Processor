# Dashboard (Person D)

Pick ONE and delete the other section.

## Option 1 — React (Vite)
```bash
npm create vite@latest . -- --template react-ts
npm install
npm run dev          # proxy /api to http://localhost:8080 in vite.config.ts
npm run build        # copy dist/* into ../src/Jobs.Api/wwwroot
```
Poll `/api/jobs/stats` and `/api/jobs` every 2 seconds.

## Option 2 — Blazor
Add Razor components inside `src/Jobs.Api` (Blazor Server) and delete this folder. Use `HttpClient` against the same app, or call the repository directly.
