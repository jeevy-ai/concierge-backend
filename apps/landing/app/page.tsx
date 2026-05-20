"use client";

import Link from "next/link";
import { useEffect } from "react";
import { track, trackPageView, observeSection } from "./lib/analytics";

const PRICE_MONTHLY = 29;
const PRICE_ANNUAL = 249;

export default function HomePage() {
  useEffect(() => {
    trackPageView();
    observeSection("[data-analytics='video_section']", "founder_video_viewed", { section: "founder_video" });
    observeSection("#pricing", "pricing_section_viewed", { section: "pricing" });
    observeSection("[data-analytics='social_proof_section']", "social_proof_viewed", { section: "social_proof" }, 0.25);
    observeSection("[data-analytics='final_cta_section']", "final_cta_viewed", { section: "final_cta" }, 0.25);
  }, []);

  return (
    <main className="min-h-screen bg-[#f5f4f0] flex flex-col">

      {/* S1 — Hero */}
      <section className="flex flex-col items-center justify-center px-6 pt-24 pb-16 text-center">
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
            Early access — first 50 users
          </div>
          <h1 className="text-5xl font-bold text-gray-900 tracking-tight leading-tight mb-6">
            Your AI concierge,
            <br />
            <span className="text-indigo-600">built for your workflow.</span>
          </h1>
          <p className="text-xl text-gray-500 mb-10 leading-relaxed">
            Jeevy handles scheduling, inbox triage, and follow-ups — personalized to how you actually
            work.
          </p>
          <Link
            href="/apply"
            onClick={() => track("hero_cta_engaged", { position: "hero" })}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-150"
          >
            Get early access →
          </Link>
          <p className="mt-4 text-sm text-gray-400">Takes ~2 minutes · No commitment</p>
        </div>
      </section>

      {/* S1.5 — Founder Video */}
      <section
        data-analytics="video_section"
        className="px-6 py-16 bg-gray-900 flex flex-col items-center text-center"
      >
        <p className="text-xs font-semibold tracking-widest uppercase text-amber-400 mb-3">
          See how it works
        </p>
        <h2 className="text-3xl font-bold text-white mb-8">Watch one concierge session.</h2>
        <div className="w-full max-w-3xl">
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              src="https://www.loom.com/embed/PLACEHOLDER_LOOM_ID?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true"
              className="absolute inset-0 w-full h-full rounded-xl border border-white/10"
              allowFullScreen
              onLoad={() => track("founder_video_play_clicked", { video: "founder_intro" })}
            />
          </div>
        </div>
        <p className="mt-4 text-sm text-gray-400">
          3 min · Noah walks through a real concierge session — one message, six actions.
        </p>
        <p className="mt-2 text-sm text-indigo-300">
          → Recording in progress.{" "}
          <Link href="/apply" className="underline hover:text-white transition-colors">
            Join the waitlist
          </Link>{" "}
          to get notified when we launch.
        </p>
      </section>

      {/* S5.5 — Pricing */}
      <section
        id="pricing"
        data-analytics="pricing_section"
        className="px-6 py-20 flex flex-col items-center text-center"
      >
        <p className="text-xs font-semibold tracking-widest uppercase text-indigo-500 mb-3">
          Pricing
        </p>
        <h2 className="text-4xl font-bold text-gray-900 mb-4">
          Lock in your rate before public launch.
        </h2>
        <p className="text-lg text-gray-500 mb-12 max-w-xl">
          We&apos;re letting the first 50 users in at a founder rate. The price goes up when we open
          to everyone.
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
            <Link
              href="/apply"
              onClick={() => track("nav_cta_clicked", { position: "pricing_founder" })}
              className="w-full text-center rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Get early access →
            </Link>
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
            <p className="text-gray-500 mb-6 flex-1">
              Full-price access once we open to everyone.
            </p>
            <Link
              href="/apply"
              onClick={() => track("nav_cta_clicked", { position: "pricing_standard" })}
              className="w-full text-center rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Join the waitlist
            </Link>
          </div>
        </div>

        <p className="mt-8 text-sm text-gray-400">
          All plans include: no setup fees · cancel anytime · your data stays private
        </p>
      </section>

      {/* S6 — Social Proof */}
      <section
        data-analytics="social_proof_section"
        className="px-6 py-16 bg-white/50 flex flex-col items-center text-center"
      >
        <p className="text-sm text-gray-400 mb-6">Trusted by people who run too many tabs</p>

        {/* Logo placeholder bar */}
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

        {/* Testimonials */}
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
              key={i}
              className="rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm"
            >
              <p className="text-gray-700 mb-4 text-sm leading-relaxed">
                &ldquo;{t.quote}&rdquo;
              </p>
              <p className="text-sm font-semibold text-gray-900">{t.name}</p>
              <p className="text-xs text-gray-400">{t.title}</p>
            </div>
          ))}
        </div>

        {/* Waitlist count badge */}
        <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
          <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          500+ people have joined the waitlist
        </div>
      </section>

      {/* S7 — Final CTA */}
      <section
        data-analytics="final_cta_section"
        className="px-6 py-24 flex flex-col items-center text-center"
      >
        <h2 className="text-4xl font-bold text-gray-900 mb-4">Ready to get your time back?</h2>
        <p className="text-lg text-gray-500 mb-10 max-w-md">
          50 spots. Founder pricing. Your workflows, handled.
        </p>
        <Link
          href="/apply"
          onClick={() => track("nav_cta_clicked", { position: "final_cta" })}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-10 py-4 text-lg font-semibold text-white shadow-lg hover:bg-indigo-700 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-150"
        >
          Get early access →
        </Link>
        <p className="mt-4 text-sm text-gray-400">Takes ~2 minutes · No commitment</p>
      </section>
    </main>
  );
}
