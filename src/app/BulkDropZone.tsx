'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

type UploadResult = {
  filename: string;
  originalName: string;
  status: 'success' | 'error';
  error?: string;
};

type UploadResponse = {
  ok: boolean;
  uploaded?: number;
  failed?: number;
  results?: UploadResult[];
  error?: string;
};

type BulkDropZoneProps = {
  onUploadComplete?: (results: UploadResult[]) => void;
};

// Helper to recursively get all files from dropped items (for folder support)
async function getAllFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = [];
  const items = Array.from(dataTransfer.items);

  for (const item of items) {
    if (item.kind === 'file') {
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        const entryFiles = await readEntryRecursively(entry);
        files.push(...entryFiles);
      } else {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
  }

  return files;
}

async function readEntryRecursively(entry: FileSystemEntry): Promise<File[]> {
  const files: File[] = [];

  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    files.push(file);
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    for (const subEntry of entries) {
      const subFiles = await readEntryRecursively(subEntry);
      files.push(...subFiles);
    }
  }

  return files;
}

export function BulkDropZone({ onUploadComplete }: BulkDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [lastResult, setLastResult] = useState<{
    uploaded: number;
    failed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const uploadFiles = async (files: File[]) => {
    const pdfFiles = files.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfFiles.length === 0) {
      setError('No PDF files found. Please select PDF files only.');
      return;
    }

    const skipped = files.length - pdfFiles.length;
    if (skipped > 0) {
      setError(`${skipped} non-PDF file${skipped > 1 ? 's were' : ' was'} skipped.`);
    } else {
      setError(null);
    }

    setIsUploading(true);
    setUploadProgress({ current: 0, total: pdfFiles.length });
    setLastResult(null);

    try {
      const formData = new FormData();
      pdfFiles.forEach((file) => {
        formData.append('files', file);
      });

      // Use XMLHttpRequest for progress tracking
      const response = await new Promise<UploadResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * pdfFiles.length);
            setUploadProgress({ current: progress, total: pdfFiles.length });
          }
        });

        xhr.addEventListener('load', () => {
          try {
            const data = JSON.parse(xhr.responseText) as UploadResponse;
            resolve(data);
          } catch {
            reject(new Error('Invalid response from server'));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.open('POST', '/api/bulk-upload');
        xhr.send(formData);
      });

      if (!response.ok) {
        throw new Error(response.error || 'Upload failed');
      }

      setLastResult({
        uploaded: response.uploaded ?? 0,
        failed: response.failed ?? 0,
      });

      if (response.results && onUploadComplete) {
        onUploadComplete(response.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // Use the recursive reader to handle folders
    const files = await getAllFilesFromDataTransfer(e.dataTransfer);
    await uploadFiles(files);
  };

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input so same files can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFolderInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      await uploadFiles(files);
    }
    // Reset input so same folder can be selected again
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const handleClickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleClickFolder = () => {
    folderInputRef.current?.click();
  };

  return (
    <div className="w-full">
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        onChange={handleFileInput}
        className="hidden"
        disabled={isUploading}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept=".pdf,application/pdf"
        // @ts-expect-error webkitdirectory is not in the types but works in browsers
        webkitdirectory=""
        // @ts-expect-error directory is not in the types but works in some browsers
        directory=""
        multiple
        onChange={handleFolderInput}
        className="hidden"
        disabled={isUploading}
      />

      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 transition-all ${
          isDragOver
            ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-400 dark:bg-emerald-950/30'
            : isUploading
            ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/30'
            : 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900'
        }`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center gap-4">
            {/* Spinner */}
            <div className="relative h-16 w-16">
              <svg className="h-16 w-16 animate-spin" viewBox="0 0 24 24">
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
            </div>

            <div className="text-center">
              <p className="text-lg font-medium text-amber-700 dark:text-amber-300">
                Uploading...
              </p>
              {uploadProgress && (
                <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                  {uploadProgress.current} of {uploadProgress.total} files
                </p>
              )}
            </div>

            {/* Progress bar */}
            {uploadProgress && (
              <div className="mt-2 h-2 w-48 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-900">
                <div
                  className="h-full bg-amber-500 transition-all duration-300"
                  style={{
                    width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Icon */}
            <div
              className={`mb-4 rounded-full p-4 ${
                isDragOver
                  ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-400'
                  : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              <svg
                className="h-10 w-10"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>

            {/* Text */}
            <div className="text-center">
              <p
                className={`text-lg font-medium ${
                  isDragOver
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {isDragOver ? 'Drop PDFs or folder here' : 'Drag & drop PDF resumes or a folder'}
              </p>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                or choose an option below
              </p>
              
              {/* Action buttons */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleClickFiles}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Select Files
                </button>
                <button
                  type="button"
                  onClick={handleClickFolder}
                  className="inline-flex items-center gap-2 rounded-full border-2 border-zinc-300 bg-transparent px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Select Folder
                </button>
              </div>

              <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
                Supports folders with PDFs • Max 10MB per file • PDF only
              </p>
            </div>
          </>
        )}
      </div>

      {/* Result/Error Messages */}
      {(lastResult || error) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {lastResult && (
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {lastResult.uploaded} uploaded
              {lastResult.failed > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  , {lastResult.failed} failed
                </span>
              )}
            </span>
          )}
          {error && (
            <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}


