"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useState } from "react";
import { track, AnalyticsEventName } from "@jeevy/analytics/web";
import { trackSignupStarted, trackSignupSubmitted, trackSignupFailed } from "@/app/lib/signup-tracking";
import { ProgressBar } from "./ProgressBar";
import { StepCalendars } from "./StepCalendars";
import { StepContact } from "./StepContact";
import { StepGoals } from "./StepGoals";
import { StepMessaging } from "./StepMessaging";
import { StepSuccess } from "./StepSuccess";
import { StepTransition } from "./StepTransition";

type FormStep = "welcome" | "goals" | "calendars" | "messaging" | "success" | "contact";

const STEP_ORDER: FormStep[] = ["welcome", "goals", "calendars", "messaging", "success", "contact"];

const PROGRESS_STEP: Record<FormStep, number> = {
  welcome: 0,
  goals: 1,
  calendars: 2,
  messaging: 3,
  success: 4,
  contact: 5,
};

interface FormData {
  goals: string[];
  goalsOther: string;
  calendars: string[];
  calendarsOther: string;
  messagingTools: string[];
  messagingOther: string;
  successCriterion: string;
  firstName: string;
  lastName: string;
  email: string;
  contactPreference:
    | "pref_email_link"
    | "pref_slack"
    | "pref_whatsapp"
    | "pref_async"
    | "pref_call"
    | "";
}

type FormAction =
  | { type: "SET_GOALS"; goals: string[]; goalsOther: string }
  | { type: "SET_CALENDARS"; calendars: string[]; calendarsOther: string }
  | { type: "SET_MESSAGING"; messagingTools: string[]; messagingOther: string }
  | { type: "SET_SUCCESS"; successCriterion: string }
  | { type: "SET_CONTACT"; data: Partial<FormData> };

function formReducer(state: FormData, action: FormAction): FormData {
  switch (action.type) {
    case "SET_GOALS":
      return { ...state, goals: action.goals, goalsOther: action.goalsOther };
    case "SET_CALENDARS":
      return { ...state, calendars: action.calendars, calendarsOther: action.calendarsOther };
    case "SET_MESSAGING":
      return {
        ...state,
        messagingTools: action.messagingTools,
        messagingOther: action.messagingOther,
      };
    case "SET_SUCCESS":
      return { ...state, successCriterion: action.successCriterion };
    case "SET_CONTACT":
      return { ...state, ...action.data };
    default:
      return state;
  }
}

const initialFormData: FormData = {
  goals: [],
  goalsOther: "",
  calendars: [],
  calendarsOther: "",
  messagingTools: [],
  messagingOther: "",
  successCriterion: "",
  firstName: "",
  lastName: "",
  email: "",
  contactPreference: "",
};

export function ApplyShell() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<FormStep>("welcome");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [formData, dispatch] = useReducer(formReducer, initialFormData);

  useEffect(() => {
    trackSignupStarted({ planIntent: "founder" });
  }, []);

  function advance() {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx < STEP_ORDER.length - 1) {
      setDirection("forward");
      setCurrentStep(STEP_ORDER[idx + 1] as FormStep);
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(currentStep);
    if (idx > 0) {
      setDirection("back");
      setCurrentStep(STEP_ORDER[idx - 1] as FormStep);
    }
  }

  async function handleSubmit() {
    if (!formData.contactPreference) throw new Error("Contact preference required");

    const payload = {
      goals: formData.goals,
      ...(formData.goalsOther ? { goalsOther: formData.goalsOther } : {}),
      calendars: formData.calendars,
      ...(formData.calendarsOther ? { calendarsOther: formData.calendarsOther } : {}),
      messagingTools: formData.messagingTools,
      ...(formData.messagingOther ? { messagingOther: formData.messagingOther } : {}),
      successCriterion: formData.successCriterion,
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email,
      contactPreference: formData.contactPreference,
      submittedAt: new Date().toISOString(),
    };

    // Track signup_submitted event (assume email method for form submission)
    trackSignupSubmitted("email", { planIntent: "founder" });

    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        trackSignupFailed("email", `http_${res.status}`);
        throw new Error(`Submission failed: ${res.status}`);
      }

      // Note: signup_completed fires server-side after account creation in auth flow
      router.push("/apply/thank-you");
    } catch (error) {
      // Track error if not already tracked
      if (!(error instanceof Error && error.message.includes("Submission failed"))) {
        trackSignupFailed("email", error instanceof Error ? error.message : "unknown_error");
      }
      throw error;
    }
  }

  const isWelcome = currentStep === "welcome";
  const progressStep = PROGRESS_STEP[currentStep];
  const totalSteps = 5;

  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-[600px]">
        {!isWelcome && (
          <div className="mb-6">
            <ProgressBar current={progressStep} total={totalSteps} />
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {!isWelcome && (
            <div className="flex items-center justify-between px-8 pt-6 pb-0">
              <button
                type="button"
                onClick={goBack}
                aria-label="Go back"
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <span className="text-xs text-gray-400" aria-current="step">
                {progressStep} of {totalSteps}
              </span>
            </div>
          )}

          <div className="px-8 py-8 md:px-10 md:py-10">
            <StepTransition key={currentStep} direction={direction}>
              {currentStep === "welcome" && (
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">
                    Your AI concierge, personalized.
                  </h1>
                  <p className="text-base text-gray-500 mb-10 leading-relaxed">
                    Answer 5 quick questions so we can set up Jeevy around your actual workflow.
                    Takes ~2 minutes.
                  </p>
                  <button
                    type="button"
                    onClick={advance}
                    className="w-full py-3.5 rounded-xl text-base font-semibold bg-indigo-600 text-white transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                  >
                    Get started →
                  </button>
                </div>
              )}

              {currentStep === "goals" && (
                <StepGoals
                  selected={formData.goals}
                  otherValue={formData.goalsOther}
                  onChange={(goals, goalsOther) =>
                    dispatch({ type: "SET_GOALS", goals, goalsOther })
                  }
                  onNext={advance}
                />
              )}

              {currentStep === "calendars" && (
                <StepCalendars
                  selected={formData.calendars}
                  otherValue={formData.calendarsOther}
                  onChange={(calendars, calendarsOther) =>
                    dispatch({ type: "SET_CALENDARS", calendars, calendarsOther })
                  }
                  onNext={advance}
                />
              )}

              {currentStep === "messaging" && (
                <StepMessaging
                  selected={formData.messagingTools}
                  otherValue={formData.messagingOther}
                  onChange={(messagingTools, messagingOther) =>
                    dispatch({ type: "SET_MESSAGING", messagingTools, messagingOther })
                  }
                  onNext={advance}
                />
              )}

              {currentStep === "success" && (
                <StepSuccess
                  value={formData.successCriterion}
                  onChange={(successCriterion) =>
                    dispatch({ type: "SET_SUCCESS", successCriterion })
                  }
                  onNext={advance}
                />
              )}

              {currentStep === "contact" && (
                <StepContact
                  data={{
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    email: formData.email,
                    contactPreference: formData.contactPreference,
                  }}
                  onChange={(data) => dispatch({ type: "SET_CONTACT", data })}
                  onSubmit={handleSubmit}
                />
              )}
            </StepTransition>
          </div>
        </div>
      </div>
    </div>
  );
}
