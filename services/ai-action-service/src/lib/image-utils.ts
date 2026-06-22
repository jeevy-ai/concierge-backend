import type { Itinerary, ItineraryItem } from "./itinerary-types.js";

function imageQuerySig(query: string): number {
  // Unsigned 32-bit djb2-style hash — stable across runs, no Date/Math.random.
  let h = 0;
  for (let i = 0; i < query.length; i++) {
    h = (h * 31 + query.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function resolveImageUrl(item: ItineraryItem, destination?: string): string {
  if (item.imageQuery) {
    const q = item.imageQuery.trim();
    const sig = imageQuerySig(q);
    return `https://source.unsplash.com/featured/?${encodeURIComponent(q)}&w=640&h=360&sig=${sig}`;
  }
  if (item.imageUrl) return item.imageUrl;
  const destSlug = destination
    ? destination.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12) + "-"
    : "";
  const titleSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
  return `https://picsum.photos/seed/${destSlug}${titleSlug}/400/280`;
}

export function enrichItineraryImages(itinerary: Itinerary | null): Itinerary | null {
  if (!itinerary) return null;
  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      items: day.items.map((item) => ({
        ...item,
        imageUrl: resolveImageUrl(item, itinerary.destination),
      })),
    })),
  };
}
