"use client";

import { useEffect } from "react";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

const SENTINELS: { sectionId: string; depth: number }[] = [
  { sectionId: "problem", depth: 25 },
  { sectionId: "how-it-works", depth: 50 },
  { sectionId: "pricing", depth: 75 },
  { sectionId: "book", depth: 100 },
];

export function ScrollDepthTracker() {
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    for (const { sectionId, depth } of SENTINELS) {
      const el = document.getElementById(sectionId);
      if (!el) continue;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            track(AnalyticsEventName.LANDING_SCROLL_DEPTH, {
              depth_pct: depth,
              section_id: sectionId,
            });
            observer.disconnect();
          }
        },
        { threshold: 0.1 },
      );

      observer.observe(el);
      observers.push(observer);
    }

    return () => {
      for (const obs of observers) obs.disconnect();
    };
  }, []);

  return null;
}
