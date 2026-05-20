# Analytics

PostHog Cloud (EU region) · `https://eu.i.posthog.com`

Two environments:
- **Staging** — separate PostHog project key. Used in development and staging deployments.
- **Production** — separate PostHog project key. Used only in production.

Both keys are stored as secrets: `POSTHOG_API_KEY` (set per environment via `wrangler secret put POSTHOG_API_KEY`). The host (`POSTHOG_HOST`) is set as a plain var in `wrangler.toml`.

---

## Event taxonomy

All event names are defined as a const object in `packages/contracts/src/analytics-events.ts` (`AnalyticsEventName`). Every name has a matching Zod schema in `analyticsEventSchemas`. **Never hardcode event name strings.** Always import from `@jeevy/contracts`.

### Current events (W6.4 taxonomy)

| Event | Surface | Required props |
|---|---|---|
| `page_viewed` | landing, app | `path` |
| `signup_started` | auth | `method` |
| `signup_completed` | auth | `userId`, `method` |
| `signin_completed` | auth | `userId`, `method` |
| `signout_completed` | auth | `userId` |
| `feature_used` | app | `featureName` |
| `recap_generated` | app | `recapId`, `itemCount` |
| `action_created` | app | `actionId`, `actionType` |
| `action_approved` | app | `actionId`, `actionType` |
| `action_rejected` | app | `actionId`, `actionType` |
| `checkout_started` | billing | `planId`, `priceId` |
| `checkout_completed` | billing | `planId`, `priceId`, `stripeCustomerId` |
| `subscription_upgraded` | billing | `fromPlanId`, `toPlanId`, `stripeCustomerId` |
| `subscription_cancelled` | billing | `planId`, `stripeCustomerId` |

Super-properties auto-attached on every event: `env`, `app_version`, `surface`.

---

## How to add a new event

### 1. Add the event name

Open `packages/contracts/src/analytics-events.ts` and add an entry to `AnalyticsEventName`:

```ts
export const AnalyticsEventName = {
  // ...existing events...
  MY_NEW_EVENT: "my_new_event",
} as const;
```

### 2. Add a Zod schema

In the same file, add an entry to `analyticsEventSchemas`:

```ts
export const analyticsEventSchemas = {
  // ...existing schemas...
  [AnalyticsEventName.MY_NEW_EVENT]: z.object({
    someRequiredField: z.string(),
    optionalField: z.string().optional(),
  }),
} satisfies Record<AnalyticsEventName, z.ZodObject<z.ZodRawShape>>;
```

The `satisfies` constraint will cause a TypeScript error if any event name lacks a schema — this is intentional.

### 3. Run the unit tests

```bash
pnpm --filter @jeevy/contracts test
```

This asserts every enum value has a matching schema.

### 4. Use the event

**Web (browser):**
```ts
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

track(AnalyticsEventName.MY_NEW_EVENT, { someRequiredField: "value" });
```

**Server (Cloudflare Workers):**
```ts
import { createServerCapture } from "@jeevy/analytics/server";
import { AnalyticsEventName } from "@jeevy/contracts";

const capture = createServerCapture({ apiKey: env.POSTHOG_API_KEY, host: env.POSTHOG_HOST });
await capture({
  distinctId: userId,
  event: AnalyticsEventName.MY_NEW_EVENT,
  props: { someRequiredField: "value" },
  superProps: { env: "production", app_version: "0.1.0", surface: "app" },
});
```

### 5. Update this doc

Add the new event to the table above with its surface and required props.

---

## Transport decisions

### Web SDK (`posthog-js`)

- `autocapture: false` on all surfaces — only manual `track()` calls.
- EU consent gate: call `initAnalytics({ requireConsent: true })` on EU traffic. SDK init is deferred until `consentGranted()` is called.
- `identify(userId, traits)` must be called on `signup_completed` to alias the anon distinct_id.

### Server-side (Workers)

**Decision: direct `fetch` to `/capture/` instead of `posthog-node`.**

Rationale: `posthog-node` uses background timers for event flushing (`setTimeout`) which are unreliable inside Cloudflare Workers request lifecycles. Direct fetch is explicit, Workers-safe, and uses `ctx.waitUntil()` for fire-and-forget behavior without blocking the response.

Helper: `createServerCapture(opts)` in `packages/analytics/src/server.ts`.

---

## Schema versioning

The `analyticsEventSchemas` object is the single source of truth. If you change required props on an existing event (breaking change), bump `packages/contracts/package.json` version and update all call sites before merging.
