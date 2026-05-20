"use client";

interface StepTransitionProps {
  direction: "forward" | "back";
  children: React.ReactNode;
}

export function StepTransition({ direction, children }: StepTransitionProps) {
  const slideClass =
    direction === "forward"
      ? "motion-safe:animate-slide-in-right motion-reduce:animate-fade-in"
      : "motion-safe:animate-slide-in-left motion-reduce:animate-fade-in";

  return <div className={slideClass}>{children}</div>;
}
