import { ResumeMonitor } from './ResumeMonitor';
import { ConditionForm } from './ConditionForm';

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-14">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Sentra Resume Monitor
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Add a new PDF to{' '}
            <code className="font-mono">dataset/sentra_test_resumes</code> and
            it will show up here in real time.
          </p>
        </header>

        <ConditionForm />
        <ResumeMonitor />
      </main>
    </div>
  );
}
