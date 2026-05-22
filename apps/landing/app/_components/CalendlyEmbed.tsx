"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

interface CalendlyEmbedProps {
  url: string;
  onScheduled?: () => void;
}

const PLACEHOLDER_URL = "https://calendly.com/PLACEHOLDER";

export function CalendlyEmbed({ url, onScheduled }: CalendlyEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPlaceholder = !url || url.includes("PLACEHOLDER");

  useEffect(() => {
    if (isPlaceholder) return;
    if (!containerRef.current) return;

    const script = document.createElement("script");
    script.src = "https://assets.calendly.com/assets/external/widget.js";
    script.async = true;
    document.body.appendChild(script);

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.event === "calendly.event_scheduled") {
        onScheduled?.();
        track(AnalyticsEventName.LANDING_WAITLIST_SUBMITTED, {
          source: "calendly_embed",
          location: "book_section",
        });
      }
    };
    window.addEventListener("message", handleMessage);

    return () => {
      document.body.removeChild(script);
      window.removeEventListener("message", handleMessage);
    };
  }, [url, onScheduled, isPlaceholder]);

  if (isPlaceholder) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] rounded-2xl border border-gray-200 bg-white/60 p-8 text-center">
        <p className="text-gray-500 mb-4 text-sm">
          Calendly booking coming soon — recording in progress.
        </p>
        <Link
          href="/apply"
          onClick={() =>
            track(AnalyticsEventName.LANDING_CTA_CLICKED, {
              cta_id: "calendly_fallback",
              location: "book_section",
              destination: "/apply",
            })
          }
          className="inline-flex items-center rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Join the waitlist →
        </Link>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="calendly-inline-widget w-full min-h-[650px] rounded-2xl overflow-hidden border border-gray-200 shadow-md"
      data-url={url}
      data-resize="true"
      title="Book a demo"
    />
  );
}
