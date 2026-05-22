import type { ReactNode } from "react";

interface HowItWorksStepProps {
  step: number;
  title: string;
  body: ReactNode;
  isLast?: boolean;
}

export function HowItWorksStep({ step, title, body, isLast }: HowItWorksStepProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center flex-shrink-0">
          {step}
        </div>
        {!isLast && (
          <div className="border-l-2 border-dashed border-indigo-200 flex-1 mt-2 mb-0 min-h-[24px]" />
        )}
      </div>
      <div className="pb-8 flex-1">
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
          <p className="font-semibold text-gray-900 mb-2">{title}</p>
          <div className="text-sm text-gray-600 leading-relaxed">{body}</div>
        </div>
      </div>
    </div>
  );
}
