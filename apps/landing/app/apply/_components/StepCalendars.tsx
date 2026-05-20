"use client";

import { useEffect, useRef } from "react";
import { ChipSelect } from "./ChipSelect";

const CALENDAR_OPTIONS = [
  { label: "Google Calendar", value: "cal_google" },
  { label: "Apple Calendar", value: "cal_apple" },
  { label: "Outlook / Microsoft 365", value: "cal_outlook" },
  { label: "Notion Calendar", value: "cal_notion" },
  { label: "Fantastical", value: "cal_fantastical" },
  { label: "Other", value: "cal_other" },
];

interface StepCalendarsProps {
  selected: string[];
  otherValue: string;
  onChange: (selected: string[], otherValue: string) => void;
  onNext: () => void;
}

export function StepCalendars({ selected, otherValue, onChange, onNext }: StepCalendarsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const canProceed = selected.length >= 1;

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl md:text-[28px] font-semibold text-gray-900 mb-2 focus:outline-none"
      >
        Which calendar systems do you use?
      </h2>
      <p className="text-sm text-gray-500 mb-6">Select all that apply.</p>

      <ChipSelect
        options={CALENDAR_OPTIONS}
        selected={selected}
        onChange={(next) => onChange(next, otherValue)}
        otherValue={otherValue}
        onOtherChange={(val) => onChange(selected, val)}
        otherPlaceholder="Which calendar?"
      />

      <div className="mt-8">
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={[
            "w-full py-3.5 rounded-xl text-base font-semibold transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
            canProceed
              ? "bg-indigo-600 text-white hover:-translate-y-px hover:shadow-md active:translate-y-0"
              : "bg-gray-100 text-gray-500 cursor-not-allowed",
          ].join(" ")}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
