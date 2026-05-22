import { z } from "zod";

// W6.4 analytics taxonomy — YOU-359

export const AnalyticsEventName = {
  // Landing (W6.4)
  LANDING_PAGE_VIEWED: "landing_page_viewed",
  LANDING_CTA_CLICKED: "landing_cta_clicked",
  LANDING_PRICING_VIEWED: "landing_pricing_viewed",
  LANDING_SIGNUP_STARTED: "landing_signup_started",
  // Generic
  PAGE_VIEWED: "page_viewed",
  // Auth
  SIGNUP_STARTED: "signup_started",
  SIGNUP_SUBMITTED: "signup_submitted",
  SIGNUP_COMPLETED: "signup_completed",
  SIGNUP_FAILED: "signup_failed",
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
  // Retention
  SAVE_INTERVIEW_INVITE_SENT: "save_interview_invite_sent",
  // Activation (W3.3 / YOU-307)
  ACTIVATION_FIRST_ACTION_ATTEMPTED: "activation_first_action_attempted",
  ACTIVATION_FIRST_VALUE_DELIVERED: "activation_first_value_delivered",
  ACTIVATION_NTH_VALUE_DELIVERED: "activation_nth_value_delivered",
  // TTFV (W2.5a / YOU-453)
  CONCIERGE_ACTION_DELIVERED: "concierge.action.delivered",
  // Landing v2 (W4.1 / YOU-630)
  LANDING_SCROLL_DEPTH: "landing_scroll_depth",
  LANDING_VIDEO_PLAYED: "landing_video_played",
  LANDING_FAQ_EXPANDED: "landing_faq_expanded",
  LANDING_WAITLIST_SUBMITTED: "landing_waitlist_submitted",
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
  [AnalyticsEventName.LANDING_PAGE_VIEWED]: z.object({
    page: z.string(),
    referrer: z.string().optional(),
    variant: z.string().optional(),
  }),
  [AnalyticsEventName.LANDING_CTA_CLICKED]: z.object({
    cta_id: z.string(),
    location: z.string(),
    destination: z.string(),
    variant: z.string().optional(),
  }),
  [AnalyticsEventName.LANDING_PRICING_VIEWED]: z.object({
    variant: z.string().optional(),
  }),
  [AnalyticsEventName.LANDING_SIGNUP_STARTED]: z.object({
    plan_intent: z.string(),
    variant: z.string().optional(),
  }),
  [AnalyticsEventName.PAGE_VIEWED]: z.object({
    path: z.string(),
    referrer: z.string().optional(),
    title: z.string().optional(),
  }),
  [AnalyticsEventName.SIGNUP_STARTED]: z.object({
    source: z.string().optional(),
    plan_intent: z.string().optional(),
  }),
  [AnalyticsEventName.SIGNUP_SUBMITTED]: z.object({
    method: authMethodSchema,
    plan_intent: z.string().optional(),
  }),
  [AnalyticsEventName.SIGNUP_COMPLETED]: z.object({
    userId: z.string(),
    method: authMethodSchema,
    plan_intent: z.string().optional(),
  }),
  [AnalyticsEventName.SIGNUP_FAILED]: z.object({
    method: authMethodSchema,
    reason_code: z.string(),
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
  [AnalyticsEventName.SAVE_INTERVIEW_INVITE_SENT]: z.object({
    userId: z.string(),
    trigger: z.string(),
  }),
  [AnalyticsEventName.ACTIVATION_FIRST_ACTION_ATTEMPTED]: z.object({
    action_type: z.enum(["calendar", "messaging", "travel"]),
    session_id: z.string(),
    correlation_id: z.string(),
  }),
  [AnalyticsEventName.ACTIVATION_FIRST_VALUE_DELIVERED]: z.object({
    action_type: z.enum(["calendar", "messaging", "travel"]),
    session_id: z.string(),
    correlation_id: z.string(),
    latency_ms: z.number().int().nonnegative(),
  }),
  [AnalyticsEventName.ACTIVATION_NTH_VALUE_DELIVERED]: z.object({
    action_type: z.enum(["calendar", "messaging", "travel"]),
    session_id: z.string(),
    correlation_id: z.string(),
    count: z.number().int().positive(),
  }),
  [AnalyticsEventName.CONCIERGE_ACTION_DELIVERED]: z.object({
    user_id: z.string(),
    action_type: z.enum(["calendar.event_created", "message.sent", "recap.delivered", "agenda.updated", "travel.itinerary_sent"]),
    correlation_id: z.string(),
    delivered_at: z.string(),
    triggered_by: z.string(),
    success: z.boolean(),
    is_test: z.boolean(),
    success_criterion_id: z.string().optional(),
    metadata: z.object({
      plan: z.string().optional(),
      source_flow: z.string().optional(),
    }).optional(),
  }),
  [AnalyticsEventName.LANDING_SCROLL_DEPTH]: z.object({
    depth_pct: z.number().int(),
    section_id: z.string().optional(),
  }),
  [AnalyticsEventName.LANDING_VIDEO_PLAYED]: z.object({
    video_id: z.string(),
  }),
  [AnalyticsEventName.LANDING_FAQ_EXPANDED]: z.object({
    question_id: z.string(),
    question_index: z.number().int(),
  }),
  [AnalyticsEventName.LANDING_WAITLIST_SUBMITTED]: z.object({
    source: z.string(),
    location: z.string(),
  }),
} satisfies Record<AnalyticsEventName, z.ZodObject<z.ZodRawShape>>;

export type AnalyticsEventPropsMap = {
  [K in AnalyticsEventName]: z.infer<(typeof analyticsEventSchemas)[K]>;
};

export type AnalyticsEvent<K extends AnalyticsEventName = AnalyticsEventName> = {
  event: K;
  props: AnalyticsEventPropsMap[K];
};
