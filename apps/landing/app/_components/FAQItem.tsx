"use client";

interface FAQItemProps {
  question: string;
  answer: string;
  id: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function FAQItem({ question, answer, id, isOpen, onToggle }: FAQItemProps) {
  const contentId = `faq-content-${id}`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={onToggle}
        className="w-full flex justify-between items-center px-6 py-4 text-left cursor-pointer hover:bg-gray-50 transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset"
      >
        <span className="font-medium text-gray-900 text-sm">{question}</span>
        <svg
          className={[
            "w-4 h-4 text-gray-400 flex-shrink-0 ml-4 transition-transform duration-200",
            isOpen ? "rotate-180" : "rotate-0",
          ].join(" ")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        id={contentId}
        className={[
          "overflow-hidden transition-[max-height] duration-300 ease-out",
          isOpen ? "max-h-[500px]" : "max-h-0",
        ].join(" ")}
      >
        <p className="px-6 pb-5 text-gray-600 text-sm leading-relaxed">{answer}</p>
      </div>
    </div>
  );
}
