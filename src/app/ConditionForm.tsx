'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

type ConditionState = {
  condition: string;
  version: number;
  updatedAt: number;
};

type FormValues = {
  condition: string;
};

export function ConditionForm() {
  const [serverState, setServerState] = useState<ConditionState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, reset, formState, watch } =
    useForm<FormValues>({
      defaultValues: { condition: '' },
    });
  const conditionValue = watch('condition') || '';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/condition', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json: ConditionState) => {
        if (cancelled) return;
        setServerState(json);
        reset({ condition: json.condition });
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error(e);
        setError('Failed to load condition.');
      });
    return () => {
      cancelled = true;
    };
  }, [reset]);

  const onSubmit = handleSubmit(async (values) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/condition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition: values.condition }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to save (${res.status})`);
      }
      const json = (await res.json()) as ConditionState;
      setServerState(json);
      reset({ condition: json.condition });
    } catch (e: any) {
      setError(e?.message || 'Failed to save condition.');
    } finally {
      setSaving(false);
    }
  });

  return (
    <section className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            Analysis condition
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            New PDFs enqueued after you save will use this condition. In-flight
            jobs keep the old one.
          </p>
        </div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {serverState ? (
            <span>v{serverState.version}</span>
          ) : (
            <span>loading…</span>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <textarea
          className="min-h-[96px] w-full resize-y rounded-xl border border-black/[.12] bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.18]"
          placeholder='e.g. "Should have 5+ years of experience as a software engineer"'
          {...register('condition', {
            required: true,
            maxLength: 255,
            validate: (v) => v.trim().length > 0,
          })}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {error ? (
              <span className="text-red-600 dark:text-red-400">{error}</span>
            ) : formState.errors.condition?.type === 'required' ||
              formState.errors.condition?.type === 'validate' ? (
              <span className="text-red-600 dark:text-red-400">
                Condition is required.
              </span>
            ) : formState.errors.condition?.type === 'maxLength' ? (
              <span className="text-red-600 dark:text-red-400">
                Condition must be ≤ 255 characters.
              </span>
            ) : !error && formState.isSubmitted && formState.isValid ? (
              <span>Saved.</span>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {conditionValue.length}/255
            </span>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center justify-center rounded-full bg-black px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {saving ? 'Saving…' : 'Save condition'}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
