import { NextResponse } from "next/server";
import type { ZodIssue } from "zod";
import { sendIntakeNotification } from "./notify";
import { IntakeSchema } from "./schema";
import { appendToSheet } from "./sheets";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = IntakeSchema.safeParse(body);
  if (!result.success) {
    const fields = Object.fromEntries(
      result.error.issues.map((issue: ZodIssue) => [issue.path.join("."), issue.message]),
    );
    return NextResponse.json({ error: "Validation failed", fields }, { status: 400 });
  }

  const data = result.data;

  try {
    await sendIntakeNotification(data);
  } catch (err) {
    console.error("[intake] email send failed — payload follows");
    console.error(JSON.stringify(data));
    console.error(err);
    return NextResponse.json({ error: "Failed to send notification" }, { status: 500 });
  }

  try {
    await appendToSheet(data);
  } catch (err) {
    console.error("[intake] sheets append failed (non-fatal)");
    console.error(err);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
