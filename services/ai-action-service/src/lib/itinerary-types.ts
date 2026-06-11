export interface ItineraryItem {
  time: string;
  title: string;
  detail: string;
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
