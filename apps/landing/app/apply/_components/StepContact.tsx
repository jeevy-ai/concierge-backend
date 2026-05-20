"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Please enter a valid email address"),
  contactPreference: z.enum(
    ["pref_email_link", "pref_slack", "pref_whatsapp", "pref_async", "pref_call"],
    { errorMap: () => ({ message: "Please select a contact preference" }) }
  ),
});

const CONTACT_PREFS = [
  { label: "Email me a scheduling link", value: "pref_email_link" },
  { label: "Slack DM", value: "pref_slack" },
  { label: "WhatsApp", value: "pref_whatsapp" },
  { label: "Async only — email, no calls", value: "pref_async" },
  { label: "Open to a quick 15-min call", value: "pref_call" },
] as const;

type ContactPreference = (typeof CONTACT_PREFS)[number]["value"];

interface ContactData {
  firstName: string;
  lastName: string;
  email: string;
  contactPreference: ContactPreference | "";
}

interface StepContactProps {
  data: ContactData;
  onChange: (data: Partial<ContactData>) => void;
  onSubmit: () => Promise<void>;
}

type FieldName = keyof typeof contactSchema.shape;
type FieldErrors = Partial<Record<FieldName, string>>;

export function StepContact({ data, onChange, onSubmit }: StepContactProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function validateField(name: FieldName, value: string): string | undefined {
    const partial = { ...data, [name]: value };
    const result = contactSchema.safeParse(partial);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === name);
      return issue?.message;
    }
    return undefined;
  }

  function handleBlur(name: FieldName) {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const value = data[name] as string;
    const error = validateField(name, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  }

  async function handleSubmit() {
    const allTouched = Object.fromEntries(
      Object.keys(contactSchema.shape).map((k) => [k, true])
    ) as Record<FieldName, boolean>;
    setTouched(allTouched);

    const result = contactSchema.safeParse(data);
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as FieldName;
        fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit();
    } catch {
      setSubmitError("Something went wrong. Try again →");
      setSubmitting(false);
    }
  }

  function field(name: FieldName) {
    const err = touched[name] ? errors[name] : undefined;
    return {
      "aria-invalid": !!err,
      "aria-describedby": err ? `${name}-error` : undefined,
      className: [
        "w-full px-4 py-3 rounded-xl border text-sm text-gray-800",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
        "transition-colors placeholder:text-gray-400",
        err ? "border-red-400 bg-red-50" : "border-gray-200 bg-white",
      ].join(" "),
    };
  }

  return (
    <div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl md:text-[28px] font-semibold text-gray-900 mb-2 focus:outline-none"
      >
        How should we reach out to set you up?
      </h2>
      <p className="text-sm text-gray-500 mb-6">Almost there — just a few details.</p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
              First name
            </label>
            <input
              id="firstName"
              type="text"
              value={data.firstName}
              onChange={(e) => onChange({ firstName: e.target.value })}
              onBlur={() => handleBlur("firstName")}
              autoComplete="given-name"
              placeholder="Alex"
              {...field("firstName")}
            />
            {touched.firstName && errors.firstName && (
              <p id="firstName-error" role="alert" className="mt-1 text-xs text-red-600">
                {errors.firstName}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-1">
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              value={data.lastName}
              onChange={(e) => onChange({ lastName: e.target.value })}
              onBlur={() => handleBlur("lastName")}
              autoComplete="family-name"
              placeholder="Rivera"
              {...field("lastName")}
            />
            {touched.lastName && errors.lastName && (
              <p id="lastName-error" role="alert" className="mt-1 text-xs text-red-600">
                {errors.lastName}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={data.email}
            onChange={(e) => onChange({ email: e.target.value })}
            onBlur={() => handleBlur("email")}
            autoComplete="email"
            placeholder="alex@company.com"
            {...field("email")}
          />
          {touched.email && errors.email && (
            <p id="email-error" role="alert" className="mt-1 text-xs text-red-600">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <fieldset>
            <legend className="block text-sm font-medium text-gray-700 mb-3">
              Contact preference
            </legend>
            <div className="space-y-2">
              {CONTACT_PREFS.map((pref) => (
                <label
                  key={pref.value}
                  className={[
                    "flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer",
                    "transition-colors min-h-[44px]",
                    data.contactPreference === pref.value
                      ? "border-indigo-600 bg-indigo-50"
                      : "border-gray-200 bg-white hover:border-gray-300",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="contactPreference"
                    value={pref.value}
                    checked={data.contactPreference === pref.value}
                    onChange={() => {
                      onChange({ contactPreference: pref.value });
                      setTouched((prev) => ({ ...prev, contactPreference: true }));
                      setErrors((prev) => ({ ...prev, contactPreference: undefined }));
                    }}
                    className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-800">{pref.label}</span>
                </label>
              ))}
            </div>
            {touched.contactPreference && errors.contactPreference && (
              <p id="contactPreference-error" role="alert" className="mt-2 text-xs text-red-600">
                {errors.contactPreference}
              </p>
            )}
          </fieldset>
        </div>
      </div>

      {submitError && (
        <div role="alert" className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700">{submitError}</p>
        </div>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={[
            "w-full py-3.5 rounded-xl text-base font-semibold transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
            "flex items-center justify-center gap-2",
            submitting
              ? "bg-indigo-400 text-white cursor-not-allowed"
              : "bg-indigo-600 text-white hover:-translate-y-px hover:shadow-md active:translate-y-0",
          ].join(" ")}
        >
          {submitting ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Submitting…
            </>
          ) : (
            "Submit →"
          )}
        </button>
      </div>
    </div>
  );
}
