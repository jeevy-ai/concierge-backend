"use client";

import { useId } from "react";

interface ChipOption {
  label: string;
  value: string;
}

interface ChipSelectProps {
  options: ChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  maxSelect?: number;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
  otherPlaceholder?: string;
}

export function ChipSelect({
  options,
  selected,
  onChange,
  maxSelect,
  otherValue = "",
  onOtherChange,
  otherPlaceholder = "Describe...",
}: ChipSelectProps) {
  const inputId = useId();

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      if (maxSelect !== undefined && selected.length >= maxSelect) return;
      onChange([...selected, value]);
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        const isOther = opt.value.endsWith("_other");
        const atMax =
          maxSelect !== undefined && selected.length >= maxSelect && !isSelected;

        return (
          <div key={opt.value} className="flex flex-col gap-2">
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => toggle(opt.value)}
              disabled={atMax}
              className={[
                "flex items-center gap-1.5 px-4 py-2.5 rounded-full border text-sm font-medium",
                "min-h-[44px] min-w-[44px] transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                isSelected
                  ? "bg-indigo-600 border-indigo-600 text-white scale-[1.02] shadow-sm"
                  : atMax
                  ? "bg-white border-gray-200 text-gray-300 cursor-not-allowed"
                  : "bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:text-indigo-600 cursor-pointer",
              ].join(" ")}
            >
              {isSelected && (
                <svg
                  className="w-3.5 h-3.5 flex-none"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {opt.label}
            </button>
            {isOther && isSelected && onOtherChange && (
              <input
                id={`${inputId}-other`}
                type="text"
                value={otherValue}
                onChange={(e) => onOtherChange(e.target.value)}
                placeholder={otherPlaceholder}
                aria-label="Describe other option"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
