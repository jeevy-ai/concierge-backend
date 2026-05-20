"use client";

import { useEffect, useRef, useState } from "react";

interface StepSuccessProps {
  value: string;
  onChange: (value: string) => void;
  onNext: () => void;
}

export function StepSuccess({ value, onChange, onNext }: StepSuccessProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [touched, setTouched] = useState(false);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const isValid = value.trim().length >= 10;
  const showError = touched && !isValid;

  function handleNext() {
    if (!isValid) {
      setTouched(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 300);
      return;
    }
    onNext();
  }

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl md:text-[28px] font-semibold text-gray-900 mb-2 focus:outline-none"
      >
        What does success look like 30 days from now?
      </h2>
      <p id="success-hint" className="text-sm text-gray-500 mb-6">
        In your own words — this helps us personalize your kickoff call.
      </p>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-label="Success criterion"
        aria-describedby={showError ? "success-error" : "success-hint"}
        aria-invalid={showError}
        placeholder="e.g. No more double-bookings, and I get 3 uninterrupted hours of deep work per day"
        className={[
          "w-full px-4 py-3 rounded-xl border text-sm text-gray-800 resize-none",
          "min-h-[120px] md:min-h-[140px]",
          "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
          "transition-all duration-150 placeholder:text-gray-400",
          shaking ? "animate-shake" : "",
          showError ? "border-red-400 bg-red-50" : "border-gray-200 bg-white",
        ].join(" ")}
      />

      {showError && (
        <p id="success-error" role="alert" className="mt-2 text-sm text-red-600">
          Please write at least 10 characters.
        </p>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={handleNext}
          className="w-full py-3.5 rounded-xl text-base font-semibold bg-indigo-600 text-white transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          Almost done →
        </button>
      </div>
    </div>
  );
}
