# concierge-backend

Monorepo for concierge backend services under the `jeevy-ai` org.

## Services

| Service | Description |
| --- | --- |
| `services/ai-action-service` | Handles calendar reschedule and participant outreach actions |
| `services/ai-recap-service` | Generates meeting recaps and summaries |

## Packages

| Package | Description |
| --- | --- |
| `packages/contracts` | Shared TypeScript types for adapter calls and orchestrator state machine |

## Getting Started

```bash
# Install dependencies
pnpm install

# Typecheck all packages
pnpm typecheck

# Lint
pnpm lint

# Test
pnpm test

# Build all
pnpm build
```

## Stack

- **Runtime**: Cloudflare Workers
- **Framework**: [Hono](https://hono.dev)
- **Language**: TypeScript (strict, ESM)
- **Package manager**: pnpm workspaces
- **Linter/Formatter**: Biome
- **Tests**: Vitest
- **CI**: GitHub Actions

## Concierge UI (Internal MVP)

A hosted web page for internal testing without curl. Located at `public/index.html`.

### Open locally (no install required)

```bash
# Serve the public directory with any static server:
python3 -m http.server 8080 --directory public
# then open http://localhost:8080
```

Or open `public/index.html` directly in a browser (file://) — all requests go to the production Workers endpoints via CORS.

### Production endpoints (pre-filled in the UI)

| Endpoint | URL |
| --- | --- |
| AI Action Service | `https://ai-action-service.noahlaux.workers.dev/v1/ai/action` |
| AI Recap Service | `https://ai-recap-service.noahlaux.workers.dev/v1/ai/recap` |

No auth token required (`AUTH_MODE=none`).

### Test user IDs

| User ID | Persona |
| --- | --- |
| `test-ux` | Designer — design tools, research tabs |
| `test-qa` | QA engineer — mix of productivity tabs |
| `test-ceo` | Executive — heavy calendar, outreach |

### Running an action end-to-end

1. Open the UI and set **User ID** (default: `test-ux`).
2. Click **Load demo tabs** to pre-fill 5 representative tabs.
3. Select an **Action** (e.g. `regroup_windows`).
4. Click **Run** — structured result appears on the right.
5. Low-confidence results surface a yellow warning banner automatically.

### Running a recap

1. Switch to the **Recap** tab in the sidebar.
2. Click **Load demo intent windows** to populate sample data.
3. Click **Run** — clusters appear with suggested actions.

> **Known issue (2026-05-21):** The hosted recap service returns UPSTREAM_ERROR 502 because Vertex AI credentials are not configured in the Workers deployment. The UI surfaces this gracefully. Fix tracked in [YOU-535](/YOU/issues/YOU-535).

## Development

Each service runs locally with Wrangler:

```bash
cd services/ai-action-service
pnpm dev
```
