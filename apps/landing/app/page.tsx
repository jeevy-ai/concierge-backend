"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";
import { StickyNav } from "./_components/StickyNav";
import { StatCard } from "./_components/StatCard";
import { HowItWorksStep } from "./_components/HowItWorksStep";
import { VideoEmbed } from "./_components/VideoEmbed";
import { FAQList } from "./_components/FAQList";
import { CalendlyEmbed } from "./_components/CalendlyEmbed";
import { ScrollDepthTracker } from "./_components/ScrollDepthTracker";

const PRICE_MONTHLY = 29;
const PRICE_ANNUAL = 249;

const NAV_LINKS = [
  { label: "Problem", href: "#problem" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
];

const FAQ_ITEMS = [
  {
    id: "what_does_jeevy_do",
    question: "What does Jeevy actually do?",
    answer:
      'Jeevy is an AI concierge for calendar and outreach. You send it one message — "reschedule my 3pm and send a recap to the team" — and it handles the emails, calendar updates, and follow-ups. You review and approve before anything goes out.',
  },
  {
    id: "calendar_integration",
    question: "How does the calendar integration work?",
    answer:
      "Jeevy connects via OAuth to Google Calendar or Outlook. Read-only by default; write access only when you explicitly approve an action.",
  },
  {
    id: "data_privacy",
    question: "Is my calendar data private?",
    answer:
      "Yes. We don't train on your data, don't share it with third parties, and you can revoke access at any time.",
  },
  {
    id: "vs_calendly",
    question: "How is this different from Calendly?",
    answer:
      "Calendly lets others book time with you. Jeevy handles the work around scheduling — rescheduling, follow-ups, recap emails, itinerary building — on your behalf.",
  },
  {
    id: "integrations",
    question: "What integrations does Jeevy support?",
    answer:
      "Google Calendar, Outlook, Gmail, and Slack at launch. More integrations added based on user feedback.",
  },
  {
    id: "cancel_anytime",
    question: "Can I cancel anytime?",
    answer:
      "Yes. No lock-ins, no cancellation fee. Monthly plan cancels at end of billing period. Annual plan is refundable within 30 days.",
  },
];

const CALENDLY_URL = process.env.NEXT_PUBLIC_CALENDLY_URL ?? "";

function observePricingSection(): void {
  if (typeof window === "undefined") return;
  const el = document.querySelector("#pricing");
  if (!el) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          track(AnalyticsEventName.LANDING_PRICING_VIEWED, {});
          observer.disconnect();
        }
      }
    },
    { threshold: 0.5 },
  );
  observer.observe(el);
}

export default function HomePage() {
  const heroRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    track(AnalyticsEventName.LANDING_PAGE_VIEWED, {
      page: "home",
      referrer: document.referrer || undefined,
    });
    observePricingSection();
  }, []);

  return (
    <>
      <StickyNav links={NAV_LINKS} heroRef={heroRef} />
      <ScrollDepthTracker />

      <main className="min-h-screen bg-[#f5f4f0] flex flex-col">

        {/* S1 — Hero */}
        <section
          id="hero"
          ref={heroRef}
          className="scroll-mt-14 flex flex-col items-center px-6 pt-24 pb-16"
        >
          <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-12 items-center">
            {/* Left: copy */}
            <div className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700">
                Early access — first 50 users
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 tracking-tight leading-tight mb-6">
                Stop losing deals to
                <br />
                <span className="text-indigo-600">scheduling friction.</span>
              </h1>
              <p className="text-xl text-gray-500 mb-10 leading-relaxed">
                Jeevy handles every reschedule, follow-up, and booking confirm — before the other
                side goes cold.
              </p>
              <a
                href="#book"
                onClick={() =>
                  track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                    cta_id: "hero_primary",
                    location: "hero",
                    destination: "#book",
                  })
                }
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-150 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Book your 15-min demo →
              </a>
              <p className="mt-4 text-sm text-gray-400">Takes 5 min · No commitment</p>
              <div className="mt-6 flex items-center gap-1.5 justify-center lg:justify-start">
                <span className="text-amber-400 text-sm">★★★★★</span>
                <span className="text-sm text-gray-500">Joined by 500+ operators</span>
              </div>
            </div>

            {/* Right: Calendly inline on desktop */}
            <div className="hidden lg:block">
              <CalendlyEmbed url={CALENDLY_URL} />
            </div>
          </div>
        </section>

        {/* S2 — Problem */}
        <section
          id="problem"
          className="scroll-mt-14 px-6 py-20 flex flex-col items-center text-center"
        >
          <div className="max-w-4xl w-full">
            <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 mb-3">
              The problem
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Scheduling friction kills deals.
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-10 mb-8">
              <StatCard stat="11" label="Average emails to book one meeting" />
              <StatCard stat="48 hrs" label="Average response delay after a meeting request" />
              <StatCard stat="23%" label="Deals attributed to scheduling delays*" />
            </div>
            <p className="text-lg text-gray-500">
              Jeevy eliminates the back-and-forth entirely.
            </p>
            <p className="text-xs text-gray-400 mt-2">*estimated</p>
          </div>
        </section>

        {/* S3 — How It Works */}
        <section
          id="how-it-works"
          className="scroll-mt-14 px-6 py-20 bg-white/40 flex flex-col items-center text-center"
        >
          <div className="max-w-4xl w-full">
            <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 mb-3">
              How it works
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              One message. Six actions taken.
            </h2>
            <p className="text-xl text-gray-500 mb-12 leading-relaxed">
              Your AI concierge works while you focus on the deal.
            </p>

            <div className="max-w-2xl mx-auto text-left">
              <HowItWorksStep
                step={1}
                title="You send one message"
                body={
                  <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 mt-1 italic text-indigo-800">
                    &ldquo;Reschedule tomorrow&apos;s intro call and send a recap to the team.&rdquo;
                  </div>
                }
              />
              <HowItWorksStep
                step={2}
                title="Jeevy builds the action plan"
                body={
                  <div className="flex flex-wrap gap-2 mt-1">
                    {["📅 Calendar event", "✉️ Email draft", "💬 Slack message"].map((chip) => (
                      <span
                        key={chip}
                        className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                }
              />
              <HowItWorksStep
                step={3}
                title="Done in minutes — you confirm once"
                isLast
                body={
                  <ul className="mt-1 space-y-1">
                    {[
                      "Meeting rescheduled",
                      "Recap sent",
                      "Calendar updated",
                    ].map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                }
              />
            </div>

            <a
              href="#video"
              onClick={() =>
                track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                  cta_id: "hiw_demo",
                  location: "how_it_works",
                  destination: "#video",
                })
              }
              className="inline-flex items-center gap-2 mt-8 rounded-xl border border-indigo-200 bg-white px-6 py-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              See it in action →
            </a>
          </div>
        </section>

        {/* S4 — Video */}
        <section
          id="video"
          className="scroll-mt-14 px-6 py-16 bg-gray-900 flex flex-col items-center text-center"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-amber-400 mb-3">
            See it in action
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-white mb-8">
            Watch one concierge session.
          </h2>
          <div className="w-full max-w-3xl">
            <VideoEmbed
              src="https://www.loom.com/embed/PLACEHOLDER_LOOM_ID?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true"
              title="Founder introduction video"
            />
          </div>
          <p className="mt-4 text-sm text-gray-400">
            3 min · Noah walks through a real concierge session — one message, six actions.
          </p>
          <p className="mt-2 text-sm text-indigo-300">
            → Recording in progress.{" "}
            <Link
              href="/apply"
              onClick={() =>
                track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                  cta_id: "video_waitlist",
                  location: "video_section",
                  destination: "/apply",
                })
              }
              className="underline hover:text-white transition-colors"
            >
              Join the waitlist
            </Link>{" "}
            to get notified when we launch.
          </p>
        </section>

        {/* S5 — Social Proof */}
        <section
          id="social-proof"
          className="scroll-mt-14 px-6 py-16 bg-white/50 flex flex-col items-center text-center"
        >
          <p className="text-sm text-gray-400 mb-6">Trusted by people who run too many tabs</p>

          <div className="flex flex-wrap justify-center gap-6 mb-12 opacity-40">
            {/* LOGO_SLOT_1 */}
            <div className="h-8 w-28 rounded bg-gray-300" aria-hidden="true" />
            {/* LOGO_SLOT_2 */}
            <div className="h-8 w-24 rounded bg-gray-300" aria-hidden="true" />
            {/* LOGO_SLOT_3 */}
            <div className="h-8 w-32 rounded bg-gray-300" aria-hidden="true" />
            {/* LOGO_SLOT_4 */}
            <div className="h-8 w-20 rounded bg-gray-300" aria-hidden="true" />
            <span className="self-center text-xs text-gray-400">and more</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl mb-10">
            {[
              {
                quote: "Handles the 20 things I keep forgetting to do between meetings.",
                name: "Early tester",
                title: "Founder",
              },
              {
                quote: "Like having an EA who already knows my calendar without being trained.",
                name: "Early tester",
                title: "Operator",
              },
              {
                quote: "Saved me ~3 hours this week just on follow-up emails.",
                name: "Early tester",
                title: "Consultant",
              },
            ].map((t, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: static inline array — index is stable
                key={i}
                className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm"
              >
                <p className="text-gray-700 mb-4 text-sm leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400">{t.title}</p>
              </div>
            ))}
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            500+ people have joined the waitlist
          </div>
        </section>

        {/* S6 — Pricing */}
        <section
          id="pricing"
          className="scroll-mt-14 px-6 py-20 flex flex-col items-center text-center"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 mb-3">
            Pricing
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
            Lock in your rate before public launch.
          </h2>
          <p className="text-lg text-gray-500 mb-12 max-w-xl">
            First 50 users get founder pricing — forever.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-3xl">
            {/* Card 1 — Founder */}
            <div className="relative flex flex-col rounded-2xl border-2 border-indigo-500 bg-white p-8 shadow-lg text-left">
              <div className="mb-4 inline-flex self-start items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                Founder · Limited spots
              </div>
              <p className="text-xl font-bold text-gray-900 mb-1">Founder</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-4xl font-bold text-gray-900">${PRICE_MONTHLY}</span>
                <span className="text-gray-400">/mo</span>
              </div>
              <p className="text-sm text-gray-400 mb-4">${PRICE_ANNUAL}/yr — save 28%</p>
              <p className="text-gray-600 mb-6">
                Everything Jeevy does, at the rate that never changes.
              </p>
              <ul className="space-y-2 mb-8 text-sm text-gray-600 flex-1">
                {[
                  "Unlimited concierge requests",
                  "Calendar, travel & follow-up automation",
                  "Integrates with your existing tools",
                  "Priority onboarding",
                  "Founder pricing — locked in forever",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="text-indigo-500 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="#book"
                onClick={() =>
                  track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                    cta_id: "pricing_founder_plan",
                    location: "pricing_card_founder",
                    destination: "#book",
                  })
                }
                className="w-full text-center rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Get early access →
              </a>
            </div>

            {/* Card 2 — Standard */}
            <div className="flex flex-col rounded-2xl border border-gray-200 bg-white/60 p-8 text-left opacity-80">
              <div className="mb-4 inline-flex self-start items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500">
                At public launch
              </div>
              <p className="text-xl font-bold text-gray-900 mb-1">Standard</p>
              <div className="flex items-baseline gap-1 mb-5">
                <span className="text-2xl font-semibold text-gray-400">Coming at launch</span>
              </div>
              <p className="text-gray-500 mb-6 flex-1">Full-price access once we open to everyone.</p>
              <Link
                href="/apply"
                onClick={() =>
                  track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                    cta_id: "pricing_standard_plan",
                    location: "pricing_card_standard",
                    destination: "/apply",
                  })
                }
                className="w-full text-center rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-600 hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                Join the waitlist
              </Link>
            </div>
          </div>

          <p className="mt-8 text-sm text-gray-400">
            All plans include: no setup fees · cancel anytime · your data stays private
          </p>
        </section>

        {/* S7 — FAQ */}
        <section
          id="faq"
          className="scroll-mt-14 px-6 py-20 bg-white/40 flex flex-col items-center text-center"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 mb-3">
            FAQ
          </p>
          <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-12">
            Common questions.
          </h2>
          <FAQList items={FAQ_ITEMS} />
        </section>

        {/* S8 — Book / Calendly Embed */}
        <section
          id="book"
          className="scroll-mt-14 px-6 py-20 flex flex-col items-center text-center"
        >
          <div className="max-w-3xl w-full">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              Ready to reclaim your calendar?
            </h2>
            <p className="text-xl text-gray-500 mb-10 leading-relaxed">
              Book a free 15-minute demo.
            </p>
            <CalendlyEmbed url={CALENDLY_URL} />
            <p className="mt-6 text-sm text-gray-400">
              Prefer email?{" "}
              <a
                href="mailto:hello@jeevy.ai"
                className="underline hover:text-gray-600 transition-colors"
              >
                hello@jeevy.ai
              </a>
            </p>
          </div>
        </section>

        {/* S9 — Final CTA (fallback) */}
        <section
          id="final-cta"
          className="scroll-mt-14 px-6 py-24 flex flex-col items-center text-center"
        >
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            50 spots. Founder pricing. Your calendar, handled.
          </h2>
          <p className="text-lg text-gray-500 mb-10 max-w-md">
            Lock in your rate before public launch.
          </p>
          <a
            href="#book"
            onClick={() =>
              track(AnalyticsEventName.LANDING_CTA_CLICKED, {
                cta_id: "final_cta",
                location: "final_cta_section",
                destination: "#book",
              })
            }
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-10 py-4 text-lg font-semibold text-white shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-150 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Book your demo →
          </a>
          <p className="mt-4 text-sm text-gray-400">Takes 5 min · No commitment</p>
        </section>
      </main>
    </>
  );
}
