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

## Development

Each service runs locally with Wrangler:

```bash
cd services/ai-action-service
pnpm dev
```
