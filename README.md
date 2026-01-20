# Ashby-Integrated Resume Reviewer

AI-powered resume screening with full Ashby ATS integration. Import resumes, analyze with OpenAI, and manage candidates through an intuitive drag-and-drop interface.

## Features

- **Ashby Integration**: Import resumes directly from any Ashby job
- **AI Analysis**: OpenAI-powered resume screening with customizable conditions
- **Smart Filtering**: Filter by application status (Active/Archived) and interview stage
- **Drag & Drop**: Move candidates between Rejected, Passed, and User Reviewed
- **Auto-Archive**: Automatically archive rejected candidates in Ashby
- **Real-time Updates**: Live status changes via Server-Sent Events

## Tech Stack

- **Next.js 14** — Full-stack React framework
- **Chokidar** — File system monitoring
- **PDF-Parse** — PDF text extraction
- **OpenAI** — LLM resume analysis
- **TailwindCSS** — Styling

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local`:

```env
# Required
OPENAI_API_KEY=sk-...
ASHBY_API_KEY=...

# Optional
ANALYSIS_CONDITION="Should have 3+ years of experience..."
OPENAI_MODEL=gpt-4o-mini
ANALYSIS_MAX_CONCURRENCY=2
AUTO_ARCHIVE_REJECTED=true
```

### 3. Run the app

```bash
npm run dev
```

Open http://localhost:3000

## Workflow

```
PDF Added → pending → in_progress → good_fit/bad_fit → user_reviewed
```

1. **Import**: Pull resumes from Ashby (or drop PDFs in watched folder)
2. **Analyze**: AI screens resumes against your condition
3. **Review**: Passed candidates shown in "Passed" column
4. **Approve**: Drag to "User Reviewed" to access Ashby profile

## Ashby Integration

Full Ashby integration for importing resumes, filtering candidates, and archiving rejected applicants.

### Import from UI (Recommended) ⭐

1. Add `ASHBY_API_KEY=...` to your `.env.local` file
2. Start the app with `npm run dev`
3. Open http://localhost:3000
4. Use the **"Import from Ashby"** panel:

| Field | Description |
|-------|-------------|
| **Select Job** | Pick from all your Ashby jobs |
| **Max candidates** | Any positive number (no limit) |
| **Application Status** | `Active Only` (non-archived), `Archived Only`, or `All` |
| **Interview Stage** | Filter by stage name (e.g., "Application Review") |

### Filtering Options

- **Active Only** (default): Pulls only candidates who haven't been archived—typically new applicants in "Application Review" stage
- **Archived Only**: Pulls previously rejected/archived candidates for re-review
- **Interview Stage**: Enter partial stage name like `Application Review` or `Initial Screen` to filter

### Import via Terminal

```bash
# List all jobs
npm run ashby:pull -- --listJobs

# Pull active candidates only
npm run ashby:pull:download -- --onlyStatus Active

# Filter by interview stage
npm run ashby:pull:download -- --stageTitleIncludes "Application Review"

# Combine filters
npm run ashby:pull:download -- --onlyStatus Active --stageTitleIncludes "Application Review" --limit 100
```

### Environment Variables

```env
ASHBY_API_KEY=...                          # Required: Ashby API key
ASHBY_JOB_ID=...                           # Optional: default job ID
ASHBY_JOB_NAME_INCLUDES=...                # Optional: match job by title substring

# Advanced overrides (rarely needed)
# ASHBY_API_BASE=https://api.ashbyhq.com
# ASHBY_APPLICATION_LIST_METHOD=application.list
# ASHBY_FILE_RESOLVE_METHOD=file.getDownloadUrl
```

Downloaded PDFs go to `dataset/sentra_test_resumes/` (the watched folder).

## Resume Review UI

### Column Buttons

| Column | Resume | Ashby | Remove |
|--------|:------:|:-----:|:------:|
| **Rejected** | ❌ | ❌ | ✅ |
| **Passed** | ✅ | ❌ | ✅ |
| **User Reviewed** | ✅ | ✅ | ✅ |

- **Resume**: Opens PDF viewer modal with the candidate's resume
- **Ashby**: Links to candidate's Ashby profile (only appears after manual review)
- **Remove**: Removes candidate from UI (with undo option)

### Drag & Drop

Drag candidates between **Rejected**, **Passed**, and **User Reviewed** columns:
- Moving to **User Reviewed** unlocks the Ashby profile link
- Labels persist in `manifest.csv`

## Auto-Archive Rejected Candidates (Optional)

When a resume is analyzed and marked as `bad_fit`, the app can automatically archive the candidate in Ashby.

### Setup

1. **Enable Write permissions** in your Ashby API key settings:
   - Go to Ashby → Settings → API Keys
   - Check the **"Write"** checkbox for **"Candidates"** or **"Applications"**

2. **Add environment variables** to `.env.local`:

```env
AUTO_ARCHIVE_REJECTED=true                    # Enable auto-archiving
ASHBY_ARCHIVE_REASON_ID=<your-reason-id>      # Optional: specific archive reason
```

3. **Find your archive reason ID** (optional):
   - Call `GET /api/ashby-archive` to list available archive reasons
   - Common reasons: "Lacks Skills/Qualifications", "Not a Culture Fit", etc.

### How it works

When `AUTO_ARCHIVE_REJECTED=true`:
1. Resume is analyzed by OpenAI → marked as `bad_fit`
2. App calls Ashby API to archive the application
3. Candidate is added to `rejected_candidates.json` (permanent tracking)
4. Local PDF file is deleted (regardless of archive success)

---

## Rejected Candidate Tracking (NEW)

All rejected candidates are now tracked in `dataset/rejected_candidates.json`:

```json
{
  "version": 1,
  "lastUpdated": "2026-01-04T22:00:00Z",
  "candidates": {
    "candidate-uuid-here": {
      "applicationId": "application-uuid-here",
      "candidateName": "John Doe",
      "rejectedAt": "2026-01-04T22:00:00Z",
      "reason": "bad_fit",
      "archiveStatus": "success"
    }
  }
}
```

### Why This Matters

| Problem | Old Behavior | New Behavior |
|---------|-------------|--------------|
| **Re-downloading rejected candidates** | Clear All → re-pull → same candidates re-analyzed | Rejected candidates are skipped on pull |
| **Archive failures** | Kept in UI column, stuck in limbo | Tracked + deleted, won't reappear |
| **Scanned PDFs** | Kept in UI column, manual handling | Auto-archived + deleted, tracked |
| **Wasting OpenAI credits** | Same candidates re-analyzed | Never re-downloaded |

### What Gets Tracked

- **Bad fit candidates**: Failed the AI analysis condition
- **Scanned PDFs**: Couldn't extract text from PDF (auto-archived and deleted)
- **Archive status**: Whether Ashby archive succeeded, failed, or was skipped

### Preserved on Clear All

When you click "Clear All":
- ✅ All PDFs deleted
- ✅ manifest.csv reset
- ✅ Metadata files deleted
- ❌ `rejected_candidates.json` is **NOT** deleted

This means: Even after clearing everything, you won't re-download previously rejected candidates.

### Resetting Rejected List (Manual)

If you need to re-review previously rejected candidates (e.g., changed hiring criteria):

```bash
# Delete the rejected tracking file
rm dataset/rejected_candidates.json

# Then Clear All and re-pull
```

**⚠️ Warning**: This will allow ALL previously rejected candidates to be re-downloaded and re-analyzed (OpenAI costs).

---

## Reliability Features (NEW)

### 1. Automatic Orphan Cleanup

On server startup, the app automatically removes "orphan" entries from `manifest.csv`:
- Entries for PDF files that no longer exist on disk
- Prevents ghost candidates in the UI
- Logs cleaned entries to console

### 2. Rejected Candidate Filtering

When pulling from Ashby:
- Loads `rejected_candidates.json`
- Skips any candidate whose ID is in the rejected list
- Logs: `[ashby] Skipping previously rejected candidate: John Doe`

### 3. Scanned PDF Detection

PDFs with minimal extractable text (<100 characters) are:
- Detected before sending to OpenAI (saves API credits)
- Auto-archived in Ashby (if enabled)
- Added to rejected tracking
- Deleted from local disk

### 4. Archived Candidate Warning

When pulling from Ashby with "Archived Only" filter:
- A warning banner appears in the UI
- Warns about potential duplicates and wasted API credits
- Encourages use of "Active Only" for normal operations

---

## Edge Cases & Known Issues

### ⚠️ Remaining Issues

| Issue | Description | Impact | Workaround |
|-------|-------------|--------|------------|
| **Drag-drop not persisted to Ashby** | Moving cards only updates local manifest | Ashby status unchanged | Use Ashby button to manually update |
| **Large pulls timeout** | Pulling >500 candidates may timeout (5 min) | Incomplete imports | Pull in smaller batches |
| **Race conditions on manifest** | Rapid concurrent writes may lose data | Rare label overwrites | Write queue mitigates this |
| **SSE reconnection gaps** | Browser tab inactive → missed events | UI may be out of sync | Refresh page to resync |

### 🔧 Potential Improvements

#### Performance Optimizations

1. **Database migration** (High Impact)
   - Replace `manifest.csv` with SQLite/PostgreSQL
   - Enables proper transactions, indexing, history tracking
   - Removes file I/O bottleneck

2. **Streaming imports** (Medium Impact)
   - Stream resume downloads instead of spawning child process
   - Better progress reporting, cancellation support
   - Reduces memory usage for large batches

3. **PDF caching** (Medium Impact)
   - Cache extracted text to avoid re-parsing
   - Store in metadata alongside resume
   - Speeds up re-analysis

4. **Batch Ashby operations** (Low Impact)
   - Current: Archive one-at-a-time
   - Better: Batch archive multiple rejections
   - Reduces API calls

#### Reliability Improvements

1. **Retry queue for failed archives**
   ```
   If Ashby archive fails → add to retry queue → retry on next app start
   ```

2. **Manifest backup/versioning**
   ```
   Before writes → backup manifest.csv.bak
   Enables rollback on corruption
   ```

3. **Health checks**
   - Periodic Ashby API ping
   - OpenAI quota monitoring
   - Alert when approaching limits

#### UX Improvements

1. **Email integration**
   - Send templated emails when moving to "User Reviewed"
   - Requires Ashby Email Templates API access

2. **Bulk actions**
   - Select multiple candidates
   - Bulk move/archive/email

3. **Filtering & search**
   - Search candidates by name
   - Filter by date imported
   - Sort by analysis confidence

4. **History/audit log**
   - Track all label changes with timestamps
   - Show history per candidate
   - Export audit trail

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ashby-jobs` | GET | List all Ashby jobs |
| `/api/ashby-pull` | POST | Import resumes from Ashby |
| `/api/ashby-archive` | GET | List archive reasons |
| `/api/ashby-archive` | POST | Archive a candidate |
| `/api/ashby-email-templates` | GET | List email templates |
| `/api/resumes` | GET | List all resumes in watched folder |
| `/api/resume-events` | GET (SSE) | Real-time label updates |
| `/api/resume-pdf` | GET | Serve PDF file |
| `/api/review` | POST | Submit user review |
| `/api/reconcile` | POST | Re-trigger analysis for pending items |
| `/api/cleanup` | POST | Delete rejected resumes |
| `/api/condition` | GET/POST | Get/set analysis condition |
| `/api/openai-health` | GET | Check OpenAI connection |

---

## Environment Variables Reference

```env
# Required
OPENAI_API_KEY=sk-...                       # OpenAI API key
ASHBY_API_KEY=...                           # Ashby API key

# OpenAI Settings
OPENAI_MODEL=gpt-4o-mini                    # Model for analysis (default: gpt-4o-mini)
ANALYSIS_CONDITION="..."                    # Default screening condition
ANALYSIS_MAX_CONCURRENCY=2                  # Parallel analysis jobs

# Ashby Settings
AUTO_ARCHIVE_REJECTED=true                  # Auto-archive bad_fit candidates
ASHBY_ARCHIVE_REASON_ID=...                 # Archive reason ID (optional)
ASHBY_JOB_ID=...                            # Default job ID (optional)

# Advanced
ASHBY_API_BASE=https://api.ashbyhq.com      # API base URL
MANIFEST_PATH=./dataset/manifest.csv        # Manifest location
```

---

## Docker

```bash
docker compose up --build
```

Volume mounts:
- `./dataset` → Resume storage
- `./.env.local` → Configuration
