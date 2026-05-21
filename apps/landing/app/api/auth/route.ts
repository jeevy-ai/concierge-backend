import { createServerCapture } from "@jeevy/analytics";
import { AnalyticsEventName } from "@jeevy/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

const SignupCompletedSchema = z.object({
  userId: z.string(),
  userEmail: z.string().email(),
  method: z.enum(["email", "google", "github"]),
  planIntent: z.string().optional(),
  signupAt: z.string().datetime(),
  anonymousDistinctId: z.string().optional(),
});

type SignupCompletedPayload = z.infer<typeof SignupCompletedSchema>;

async function hashEmail(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request): Promise<NextResponse> {
  const posthogApiKey = process.env.POSTHOG_API_KEY;
  const posthogHost = process.env.POSTHOG_HOST;

  if (!posthogApiKey) {
    console.error("[auth] POSTHOG_API_KEY not configured");
    return NextResponse.json({ error: "PostHog not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = SignupCompletedSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: result.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const payload = result.data;
  const capture = createServerCapture({
    apiKey: posthogApiKey,
    host: posthogHost,
  });

  try {
    // Emit signup_completed event
    await capture({
      distinctId: payload.userId,
      event: AnalyticsEventName.SIGNUP_COMPLETED,
      props: {
        userId: payload.userId,
        method: payload.method,
        plan_intent: payload.planIntent,
      },
      superProps: {
        env: (process.env.NODE_ENV as "production" | "staging" | "development") || "development",
        app_version: process.env.APP_VERSION || "0.0.0",
        surface: "auth",
      },
    });

    // Identity stitching: alias anonymous distinct_id to user_id
    // This tells PostHog that the same user was previously identified as anonymousDistinctId
    const emailHash = await hashEmail(payload.userEmail);
    const identifyUrl = posthogHost || "https://eu.i.posthog.com";
    await fetch(`${identifyUrl}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: posthogApiKey,
        distinct_id: payload.userId,
        event: "$identify",
        properties: {
          $set: {
            email_hash: emailHash,
            plan: payload.planIntent,
            signup_at: payload.signupAt,
          },
        },
        timestamp: new Date().toISOString(),
      }),
    });

    // Send alias event if anonymous ID provided
    if (payload.anonymousDistinctId && payload.anonymousDistinctId !== payload.userId) {
      await fetch(`${identifyUrl}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: posthogApiKey,
          distinct_id: payload.anonymousDistinctId,
          event: "$identify",
          properties: {
            distinct_id: payload.userId,
          },
          timestamp: new Date().toISOString(),
        }),
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[auth] Failed to emit signup events:", err);
    return NextResponse.json({ error: "Failed to emit events" }, { status: 500 });
  }
}
