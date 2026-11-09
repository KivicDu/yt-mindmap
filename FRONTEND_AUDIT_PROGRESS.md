# Frontend audit progress

**Status: INCOMPLETE — findings recorded; no frontend fixes have been made.**

This note preserves the findings from a frontend review performed on 2026-11-10. It is a work tracker, not a claim that the items below are fixed or that the frontend has passed a full device/browser audit.

## Scope and baseline

- Reviewed the React/Vite frontend source, production build configuration, Nginx headers, and key user flows.
- Checked the landing page and workspace at a 390px viewport. No real-device or cross-browser testing was performed.
- `npm run build`: passed.
- `npm test`: passed, 6 files / 82 tests.
- `npm run lint`: completed with 3 warnings (2 Fast Refresh warnings in context modules and 1 set-state-in-effect warning on the shared-project page).
- Production build output: main JS 491.78 kB (145.16 kB gzip); lazy mind-map JS 78.08 kB (26.61 kB gzip); main CSS 86.70 kB (15.52 kB gzip).

## Outstanding work — all items are NOT STARTED

| Priority | Status | Work item | Completion criteria |
|---|---|---|---|
| P1 | NOT STARTED | Make mind-map nodes accessible by keyboard. | Nodes can be focused and operated without a pointer; selection/edit and timestamp seeking have documented keyboard interactions and automated coverage. |
| P1 | NOT STARTED | Harden SVG export of user-controlled titles. | Do not interpolate a title into an XML comment unsafely; tests cover XML-sensitive strings and the generated SVG remains valid. |
| P1 | NOT STARTED | Improve SEO metadata by route. | Public routes have appropriate titles/descriptions and share metadata; private/app routes are excluded from indexing. Evaluate prerendering/SSR for public pages because the current app is a client-rendered SPA. |
| P1 | NOT STARTED | Add a Content Security Policy and review browser security headers. | Start with a policy compatible with required YouTube embeds, Google Fonts, and theme initialization; validate in report-only mode before enforcing. Review the policy with the deployment/TLS setup. |
| P2 | NOT STARTED | Reduce initial JavaScript cost. | Consider route-level lazy loading and verify production bundle budgets after the change; keep the mind-map dependency lazy-loaded. |
| P2 | NOT STARTED | Reduce playback-time rendering work. | Profile long transcripts/maps, then avoid unnecessary React updates and use an efficient active-cue lookup where measurements justify it. |
| P2 | NOT STARTED | Review mobile workspace and shared-project header UX. | Validate layout, project context, touch targets, and scroll behavior on actual mobile/tablet sizes and devices; preserve the shared-project title in a compact form on narrow screens. |
| P3 | NOT STARTED | Reconcile frontend README with actual build behavior. | Either implement/document vendor chunk splitting or correct the README statement; verify against a fresh production build. |
| P3 | NOT STARTED | Run production-oriented quality checks. | Run Lighthouse or equivalent for representative public/app routes and perform keyboard, screen-reader, and cross-browser checks; record metrics and environment. |

## Known-positive baseline

- The mind map is loaded lazily.
- Access tokens are kept in memory rather than `localStorage`; refresh uses credentials/cookies.
- Labels and notes used to construct mind-map markup are HTML-escaped.
- Nginx config includes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, gzip, and immutable caching for hashed assets.
- The UI includes light/dark themes, visible focus styles, reduced-motion handling, and responsive breakpoints.

## Isolation note

This progress note is intended to live on a separate documentation branch. It does not contain frontend implementation changes. Pre-existing uncommitted backend work was present during the review and must remain uncommitted/unmodified by this audit.
