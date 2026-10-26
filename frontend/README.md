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

- `MindMap` is lazy-loaded: the player shell renders first, then the ~670 kB
  markmap/d3/katex bundle arrives via a Suspense fallback.
- `vite.config.ts` splits vendor code into `react`, `d3`, `markmap`, `katex` and
  `highlight` chunks so browsers can fetch and cache them independently.
- The production container serves the built `dist/` with nginx (`Dockerfile`,
  `nginx.conf`). `VITE_API_BASE` is baked in at build time, so use
  `--build-arg VITE_API_BASE=...` when deploying.
