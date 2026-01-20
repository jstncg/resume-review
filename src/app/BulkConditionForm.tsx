'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';

type FormValues = {
  condition: string;
};

type BulkConditionFormProps = {
  onConditionChange?: (condition: string) => void;
  onAnalyzeAll?: (condition: string) => void;
  pendingCount: number;
  isAnalyzing: boolean;
};

const STORAGE_KEY = 'bulk-upload-condition';

const DEFAULT_CONDITION = 'Look for students with at least 2 software engineering experiences working in real production environments. Minimum one experience at a company with high-bar engineering standards (like FAANG, Ramp, Databricks, OpenAI).';

const PRESET_CONDITIONS = [
  {
    name: '3+ Years FAANG Experience',
    condition:
      'Candidate must have 3+ years of impactful backend experience at FAANG (Google, Meta, Apple, Amazon, Netflix), FAANG-equivalent companies (Microsoft, Stripe, Airbnb, Uber, Lyft), or top-tier startups (Ramp, Databricks, Figma, Notion, etc.).',
  },
  {
    name: 'Senior Software Engineer',
    condition:
      'Candidate must have 5+ years of software engineering experience with demonstrated leadership or mentorship. Experience with system design and architecture required.',
  },
  {
    name: 'Machine Learning Engineer',
    condition:
      'Candidate must have 3+ years experience in machine learning or AI, with proficiency in Python and ML frameworks (TensorFlow, PyTorch). Production ML deployment experience preferred.',
  },
  {
    name: 'Full-Stack Developer',
    condition:
      'Candidate must have 2+ years experience with both frontend (React, Vue, or Angular) and backend (Node.js, Python, or Go) development. Database experience required.',
  },
];

export function BulkConditionForm({
  onConditionChange,
  onAnalyzeAll,
  pendingCount,
  isAnalyzing,
}: BulkConditionFormProps) {
  const [showPresets, setShowPresets] = useState(false);

  const { register, handleSubmit, watch, setValue, formState } = useForm<FormValues>({
    defaultValues: { condition: DEFAULT_CONDITION },
  });

  const conditionValue = watch('condition') || '';

  // Load from localStorage on mount, or use default
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setValue('condition', saved);
      onConditionChange?.(saved);
    } else {
      // Use the default condition
      onConditionChange?.(DEFAULT_CONDITION);
    }
  }, [setValue, onConditionChange]);

  // Save to localStorage on change
  useEffect(() => {
    if (conditionValue) {
      localStorage.setItem(STORAGE_KEY, conditionValue);
      onConditionChange?.(conditionValue);
    }
  }, [conditionValue, onConditionChange]);

  const handleAnalyze = handleSubmit((values) => {
    if (values.condition.trim()) {
      onAnalyzeAll?.(values.condition.trim());
    }
  });

  const applyPreset = (condition: string) => {
    setValue('condition', condition);
    setShowPresets(false);
  };

  return (
    <div className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50">
            Analysis Criteria
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Define the criteria to evaluate resumes against
          </p>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPresets(!showPresets)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16m-7 6h7"
              />
            </svg>
            Presets
          </button>

          {showPresets && (
            <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-black/[.08] bg-white p-2 shadow-lg dark:border-white/[.145] dark:bg-zinc-900">
              {PRESET_CONDITIONS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => applyPreset(preset.condition)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {preset.name}
                  </span>
                  <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {preset.condition}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleAnalyze} className="mt-4 flex flex-col gap-4">
        <div>
          <textarea
            className="min-h-[120px] w-full resize-y rounded-xl border border-black/[.12] bg-white px-4 py-3 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.18]"
            placeholder="Describe your ideal candidate... (e.g., '3+ years experience in backend development, familiar with distributed systems')"
            {...register('condition', {
              required: true,
              maxLength: 1000,
              validate: (v) => v.trim().length > 0,
            })}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {formState.errors.condition?.type === 'required' ||
              formState.errors.condition?.type === 'validate' ? (
                <span className="text-red-600 dark:text-red-400">
                  Criteria is required to start analysis
                </span>
              ) : formState.errors.condition?.type === 'maxLength' ? (
                <span className="text-red-600 dark:text-red-400">
                  Criteria must be ≤ 1000 characters
                </span>
              ) : (
                <span>
                  This criteria will be used to evaluate all uploaded resumes
                </span>
              )}
            </div>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {conditionValue.length}/1000
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isAnalyzing || pendingCount === 0 || !conditionValue.trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:opacity-60"
          >
            {isAnalyzing ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Analyzing...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                Analyze All ({pendingCount} pending)
              </>
            )}
          </button>
          {pendingCount === 0 && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              Upload resumes first to start analysis
            </span>
          )}
        </div>
      </form>
    </div>
  );
}


