'use client';

import { useState } from 'react';
import { ResumeMonitor } from './ResumeMonitor';
import { ConditionForm } from './ConditionForm';
import { AshbyImport, AshbyStageSync } from './AshbyImport';
import { BulkUploadTab } from './BulkUploadTab';

type TabId = 'ashby' | 'bulk';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'ashby', label: 'Ashby Import', icon: '📥' },
  { id: 'bulk', label: 'Bulk Upload', icon: '📁' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('ashby');

  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-14">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Sentra Resume Monitor
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Import resumes from Ashby, upload manually, analyze with AI, and review
            candidates—all in one place.
          </p>
        </header>

        {/* Tab Navigation */}
        <nav className="flex gap-1 rounded-2xl border border-black/[.08] bg-white p-1.5 dark:border-white/[.145] dark:bg-black">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab Content */}
        {activeTab === 'ashby' ? (
          <>
            {/* Step 1: Import from Ashby */}
            <AshbyImport />

            {/* Step 2: Configure Ashby stage sync (optional) */}
            <AshbyStageSync />

            {/* Step 3: Configure analysis criteria */}
            <ConditionForm />

            {/* Step 4: Monitor & review candidates */}
            <ResumeMonitor />
          </>
        ) : (
          <BulkUploadTab />
        )}
      </main>
    </div>
  );
}
