"use client";

import { useEffect, useRef } from "react";
import { ChipSelect } from "./ChipSelect";

const MESSAGING_OPTIONS = [
  { label: "Slack", value: "msg_slack" },
  { label: "Microsoft Teams", value: "msg_teams" },
  { label: "Gmail", value: "msg_gmail" },
  { label: "Outlook Mail", value: "msg_outlook_mail" },
  { label: "Linear", value: "msg_linear" },
  { label: "Notion", value: "msg_notion" },
  { label: "WhatsApp Business", value: "msg_whatsapp" },
  { label: "iMessage", value: "msg_imessage" },
  { label: "Other", value: "msg_other" },
];

interface StepMessagingProps {
  selected: string[];
  otherValue: string;
  onChange: (selected: string[], otherValue: string) => void;
  onNext: () => void;
}

export function StepMessaging({ selected, otherValue, onChange, onNext }: StepMessagingProps) {
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
        Which messaging tools are part of your work day?
      </h2>
      <p className="text-sm text-gray-500 mb-6">Select all that apply.</p>

      <ChipSelect
        options={MESSAGING_OPTIONS}
        selected={selected}
        onChange={(next) => onChange(next, otherValue)}
        otherValue={otherValue}
        onOtherChange={(val) => onChange(selected, val)}
        otherPlaceholder="Which tool?"
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
