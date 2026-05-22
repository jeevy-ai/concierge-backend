"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

interface NavLink {
  label: string;
  href: string;
}

interface StickyNavProps {
  links: NavLink[];
  heroRef: React.RefObject<HTMLElement | null>;
}

export function StickyNav({ links, heroRef }: StickyNavProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = heroRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry) setVisible(!entry.isIntersecting); },
      { threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [heroRef]);

  return (
    <nav
      aria-label="Page navigation"
      className={[
        "fixed top-0 inset-x-0 z-50 h-14 flex items-center px-6",
        "bg-white/80 backdrop-blur-md border-b border-gray-100",
        "transition-opacity duration-200",
        visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      ].join(" ")}
    >
      <div className="flex items-center justify-between w-full max-w-6xl mx-auto">
        <span className="font-bold text-gray-900 text-base">Jeevy</span>
        <div className="hidden md:flex items-center gap-6">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded"
            >
              {l.label}
            </a>
          ))}
        </div>
        <a
          href="#book"
          onClick={() =>
            track(AnalyticsEventName.LANDING_CTA_CLICKED, {
              cta_id: "sticky_nav_book",
              location: "sticky_nav",
              destination: "#book",
            })
          }
          className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Book a call →
        </a>
      </div>
    </nav>
  );
}
