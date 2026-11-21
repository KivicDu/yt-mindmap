# Frontend

React + TypeScript + Vite frontend for YouTube Mind Map Generator.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables (optional):
```bash
cp .env.example .env
# VITE_API_BASE defaults to http://localhost:8001
```

3. Run development server:
```bash
npm run dev -- --port 5173 --host 127.0.0.1
```

4. Build for production:
```bash
npm run build
```

## Tests and checks

```bash
npm run lint    # oxlint
npm test        # vitest (pure mind map tree helpers)
npm run build   # tsc -b + vite build
```

## Tech Stack

- React 19 + TypeScript
- Vite
- react-youtube (YouTube player)
- markmap-lib / markmap-view (mind map visualization)
- vitest (unit tests)

## Notes

- `MindMap` and route pages are lazy-loaded, so the workspace and account
  screens are fetched only when opened.
- The mind map supports Tab/arrow navigation, Enter/Space activation, and
  `+`/`-`/`0` zoom controls. Playback time is isolated from the workspace render;
  the transcript updates its active cue only when the cue changes.
- Route changes update document titles, descriptions, robots directives, and
  canonical URLs. The app is still client-rendered, so crawlers that do not run
  JavaScript need the production nginx server for share-page previews. Nginx
  uses SSI to insert metadata from the backend for unlisted share links;
  invite-only and unavailable links receive generic metadata. Share pages stay
  `noindex`. The backend `FRONTEND_URL` must match the public frontend origin
  used in generated Open Graph URLs.
- The production container serves the built `dist/` with nginx (`Dockerfile`,
  `nginx.conf`). `VITE_API_BASE` is baked in at build time, while
  `CSP_API_ORIGIN` configures the API origin allowed by the Content Security
  Policy. Set both to the public API origin when deploying, for example via
  Docker build args or the matching Docker Compose environment variables.
