import { NextResponse } from "next/server";
import { z } from "zod";

const IntakeSchema = z.object({
  goals: z.array(z.string()).min(1).max(3),
  goalsOther: z.string().optional(),
  calendars: z.array(z.string()).min(1),
  calendarsOther: z.string().optional(),
  messagingTools: z.array(z.string()).min(1),
  messagingOther: z.string().optional(),
  successCriterion: z.string().min(10).max(1000),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  contactPreference: z.enum([
    "pref_email_link",
    "pref_slack",
    "pref_whatsapp",
    "pref_async",
    "pref_call",
  ]),
  submittedAt: z.string().datetime(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = IntakeSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", fields: result.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const intakeUrl = process.env.INTAKE_API_URL;
  if (!intakeUrl) {
    console.error("[intake] INTAKE_API_URL not configured — payload follows");
    console.error(JSON.stringify(result.data));
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const upstream = await fetch(intakeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.data),
    });
    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    console.error("[intake] upstream call failed");
    console.error(err);
    return NextResponse.json({ error: "Failed to process submission" }, { status: 502 });
  }
}
