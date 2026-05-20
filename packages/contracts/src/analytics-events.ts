import { z } from "zod";

// W6.4 analytics taxonomy — YOU-359

export const AnalyticsEventName = {
  // Landing
  PAGE_VIEWED: "page_viewed",
  // Auth
  SIGNUP_STARTED: "signup_started",
  SIGNUP_COMPLETED: "signup_completed",
  SIGNIN_COMPLETED: "signin_completed",
  SIGNOUT_COMPLETED: "signout_completed",
  // App
  FEATURE_USED: "feature_used",
  RECAP_GENERATED: "recap_generated",
  ACTION_CREATED: "action_created",
  ACTION_APPROVED: "action_approved",
  ACTION_REJECTED: "action_rejected",
  // Billing
  CHECKOUT_STARTED: "checkout_started",
  CHECKOUT_COMPLETED: "checkout_completed",
  SUBSCRIPTION_UPGRADED: "subscription_upgraded",
  SUBSCRIPTION_CANCELLED: "subscription_cancelled",
} as const;

export type AnalyticsEventName = (typeof AnalyticsEventName)[keyof typeof AnalyticsEventName];

export type AnalyticsSurface = "landing" | "auth" | "app" | "billing";

export type AnalyticsSuperProperties = {
  env: "production" | "staging" | "development";
  app_version: string;
  surface: AnalyticsSurface;
};

const authMethodSchema = z.enum(["email", "google", "github"]);

export const analyticsEventSchemas = {
  [AnalyticsEventName.PAGE_VIEWED]: z.object({
    path: z.string(),
    referrer: z.string().optional(),
    title: z.string().optional(),
  }),
  [AnalyticsEventName.SIGNUP_STARTED]: z.object({
    method: authMethodSchema,
  }),
  [AnalyticsEventName.SIGNUP_COMPLETED]: z.object({
    userId: z.string(),
    method: authMethodSchema,
  }),
  [AnalyticsEventName.SIGNIN_COMPLETED]: z.object({
    userId: z.string(),
    method: authMethodSchema,
  }),
  [AnalyticsEventName.SIGNOUT_COMPLETED]: z.object({
    userId: z.string(),
  }),
  [AnalyticsEventName.FEATURE_USED]: z.object({
    featureName: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.RECAP_GENERATED]: z.object({
    recapId: z.string(),
    itemCount: z.number().int().nonnegative(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.ACTION_CREATED]: z.object({
    actionId: z.string(),
    actionType: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.ACTION_APPROVED]: z.object({
    actionId: z.string(),
    actionType: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.ACTION_REJECTED]: z.object({
    actionId: z.string(),
    actionType: z.string(),
    userId: z.string().optional(),
    reason: z.string().optional(),
  }),
  [AnalyticsEventName.CHECKOUT_STARTED]: z.object({
    planId: z.string(),
    priceId: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.CHECKOUT_COMPLETED]: z.object({
    planId: z.string(),
    priceId: z.string(),
    stripeCustomerId: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.SUBSCRIPTION_UPGRADED]: z.object({
    fromPlanId: z.string(),
    toPlanId: z.string(),
    stripeCustomerId: z.string(),
    userId: z.string().optional(),
  }),
  [AnalyticsEventName.SUBSCRIPTION_CANCELLED]: z.object({
    planId: z.string(),
    stripeCustomerId: z.string(),
    reason: z.string().optional(),
    userId: z.string().optional(),
  }),
} satisfies Record<AnalyticsEventName, z.ZodObject<z.ZodRawShape>>;

export type AnalyticsEventPropsMap = {
  [K in AnalyticsEventName]: z.infer<(typeof analyticsEventSchemas)[K]>;
};

export type AnalyticsEvent<K extends AnalyticsEventName = AnalyticsEventName> = {
  event: K;
  props: AnalyticsEventPropsMap[K];
};
