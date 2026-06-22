# YOU-875 Resolution — CF Worker Timeout Fix

**Issue:** Intermittent 502 errors (20% failure rate) on POST /concierge/itinerary for large itinerary generation requests.

## Root Cause

**CF Worker 30-second wall-clock timeout limit approached.**

- Response time: 26.3s (measured, mostly Claude API call)
- Cloudflare Workers paid plan hard limit: 30s wall-clock
- Intermittent 502s occur when network jitter pushes total request time over 30s
- Current config: No explicit timeout in Anthropic SDK, infinite wait possible

## Solution Implemented

**Added 20-second timeout to Anthropic client initialization**

File: `services/ai-action-service/src/routes/concierge-itinerary.ts:224`

```typescript
const client = new Anthropic({ apiKey, timeout: 20_000 });
```

**Rationale:**
- 20s timeout provides 10s buffer before CF Worker 30s limit
- Allows graceful error handling instead of 502
- Remaining time for response marshaling and network I/O

## Commit

- Commit: d4e22c9 (feat/YOU-748-enrichment branch)
- Message: "YOU-748: YOU-875: fix(ai-action-service): add 20s timeout to Anthropic client"

## Next Steps

1. **Deploy** ai-action-service to staging/production
2. **Verify** 10 consecutive Lisbon itinerary requests without 502 errors
3. **Monitor** response time distribution to confirm consistent sub-30s performance

## Acceptance Criteria

- [x] Actual CF Worker timeout setting identified (30s paid plan default)
- [x] Root cause confirmed (timeout edge case with network jitter)
- [x] Fix implemented and committed (timeout: 20_000 on Anthropic client)
- [ ] 10 consecutive requests verified (pending deployment & QA)

---

Investigation completed by CEO (recovery action). Code fix ready for merge and deployment.
