"use client";

import { useState } from "react";
import { FAQItem } from "./FAQItem";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";

interface FAQEntry {
  id: string;
  question: string;
  answer: string;
}

interface FAQListProps {
  items: FAQEntry[];
}

export function FAQList({ items }: FAQListProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  function handleToggle(index: number) {
    const isOpening = openIndex !== index;
    setOpenIndex(isOpening ? index : null);
    if (isOpening) {
      const item = items[index];
      if (item) {
        track(AnalyticsEventName.LANDING_FAQ_EXPANDED, {
          question_id: item.id,
          question_index: index,
        });
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 max-w-2xl mx-auto w-full">
      {items.map((item, i) => (
        <FAQItem
          key={item.id}
          question={item.question}
          answer={item.answer}
          id={item.id}
          isOpen={openIndex === i}
          onToggle={() => handleToggle(i)}
        />
      ))}
    </div>
  );
}
