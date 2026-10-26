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

## Tech Stack

- React 19 + TypeScript
- Vite
- react-youtube (YouTube player)
- markmap-lib / markmap-view (mind map visualization)
