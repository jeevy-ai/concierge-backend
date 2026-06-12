export interface TransportLeg {
  mode: string;
  duration: string;
  notes?: string;
}

export interface Transport {
  mode: string;
  duration: string;
  detail: string;
}

export interface ItineraryItem {
  time: string;
  title: string;
  detail: string;
  imageQuery?: string;
  imageUrl: string;
  transport?: Transport;
  transportAfter?: TransportLeg;
}

export interface ItineraryDay {
  day: string;
  items: ItineraryItem[];
}

export interface Itinerary {
  destination: string;
  dates: string;
  days: ItineraryDay[];
  summary: string;
}

export interface RespondResult {
  reply: string;
  itinerary: Itinerary | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
