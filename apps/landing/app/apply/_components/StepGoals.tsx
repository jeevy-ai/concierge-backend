"use client";

import { useEffect, useRef } from "react";
import { ChipSelect } from "./ChipSelect";

const GOAL_OPTIONS = [
  { label: "Zero scheduling back-and-forth", value: "goal_scheduling" },
  { label: "Deep work blocks, protected", value: "goal_deep_work" },
  { label: "Inbox triage that actually works", value: "goal_inbox" },
  { label: "Meeting follow-ups sent automatically", value: "goal_followups" },
  { label: "Calendar conflicts resolved for me", value: "goal_conflicts" },
  { label: "Better meeting prep", value: "goal_meeting_prep" },
  { label: "Faster async replies", value: "goal_async" },
  { label: "Other", value: "goal_other" },
];

interface StepGoalsProps {
  selected: string[];
  otherValue: string;
  onChange: (selected: string[], otherValue: string) => void;
  onNext: () => void;
}

export function StepGoals({ selected, otherValue, onChange, onNext }: StepGoalsProps) {
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
        What are your top 3 goals?
      </h2>
      <p className="text-sm text-gray-500 mb-6">
        Pick up to 3. We&apos;ll prioritize these in your setup.
      </p>

      <ChipSelect
        options={GOAL_OPTIONS}
        selected={selected}
        onChange={(next) => onChange(next, otherValue)}
        maxSelect={3}
        otherValue={otherValue}
        onOtherChange={(val) => onChange(selected, val)}
        otherPlaceholder="Describe your goal..."
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
