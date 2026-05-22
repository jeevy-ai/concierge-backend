"use client";

import { useState } from "react";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

interface VideoEmbedProps {
  src: string;
  title: string;
  videoId?: string;
}

export function VideoEmbed({ src, title, videoId = "founder_intro" }: VideoEmbedProps) {
  const [hasPlayed, setHasPlayed] = useState(false);

  function handlePlay() {
    setHasPlayed(true);
    track(AnalyticsEventName.LANDING_VIDEO_PLAYED, { video_id: videoId });
  }

  return (
    <div className="relative w-full aspect-video rounded-xl border border-white/10 overflow-hidden">
      {hasPlayed ? (
        <iframe
          title={title}
          src={src}
          className="absolute inset-0 w-full h-full"
          allowFullScreen
          allow="autoplay"
        />
      ) : (
        <button
          type="button"
          aria-label="Play founder video"
          onClick={handlePlay}
          className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-800 group focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-white/10 group-hover:bg-white/20 transition-colors flex items-center justify-center">
              <svg
                className="w-7 h-7 text-white ml-1"
                fill="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
            <span className="text-sm text-gray-300">Click to play</span>
          </div>
        </button>
      )}
    </div>
  );
}
