import { z } from "zod";

export const IntakeSchema = z.object({
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

export type IntakePayload = z.infer<typeof IntakeSchema>;
