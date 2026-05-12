# Planner Module

The Planner is a first-class workspace in Metis, opened from the dedicated button at the bottom of the left files sidebar.

- Planner visuals inherit the active editor color preset (background, cards, borders, and text).

## Tabs

- **Daily Log** — Monday-Friday grid with per-day planning/log fields and special-day statuses.
- **Weekly Review** — week-sorted retrospective notes with `Action Points`.
- **Monthly Review** — month-level guided reflection prompts.
- **Goals** — user-defined goal sections (editable titles + markdown bodies), persisted separately from the task manifest.
- **Templates** — reusable recurring planning templates (daily/weekly/monthly/interval).
- **PTO & Events** — tracker tables for holidays, PTO, conferences, and office trips.

## Daily Log Behavior

- Uses week columns and weekday rows (Monday-Friday).
- Workdays expose:
  - Primary block label (default: `What do I want to do`)
  - Optional secondary block label (default: `What did I do`)
- Daily block labels and secondary-block visibility are template-editable.
- Template changes apply from the current date onward; historical entries remain unchanged.
- **Work-day cells (any date):** collapsed cells match the usual compact layout. When you activate a **work** cell, the Daily Log switches to a **weighted CSS grid**: that cell’s **week column** uses `4fr` vs `1fr` on the others (~half of the four week columns), and its **weekday row** uses `3fr` vs `1fr` on the others (~40% of Mon–Fri height), giving roughly **¼ of the grid footprint** while sibling rows/columns shrink. The grid shell **`flex-1 min-h-0`** fills the planner scroll pane while expanded (horizontal scroll preserved via `min-w-[980px]`). Active editing fills the enlarged card with flex layout; blur / tab change / week nav clears expansion.
- Special-day statuses disable work-entry behavior and display centered labels.
- Office Trips are non-destructive and render as top-of-cell banners (they do not replace the block).
- Date navigation controls are context-aware:
  - Daily Log: Previous Week / Today / Next Week
  - Weekly Review: Previous Month / This Month / Next Month
  - Monthly Review: Previous Year / This Year / Next Year
- Templates, Goals, and PTO & Events intentionally hide date-navigation controls.

## Goals

- Storage key: `metis_planner_goals_v1` (JSON array in `localStorage`).
- Default sections on first load: **Business related** and **Self-Improvement** (empty bodies).
- Users may add/remove sections arbitrarily; each section has an editable title and a markdown editor (`PlannerCodeMirrorField`).
- Clearing all sections persists an empty array; the next launch with **no** saved key still seeds the two defaults (fresh profile).

## Template Engine

- Templates can be created, edited, enabled/disabled, and deleted.
- Supported cadences:
  - `daily`
  - `weekly` (with recurrence day)
  - `monthly` (with recurrence day)
  - `interval` (N days, with recurrence day)
- Auto-population rules:
  - fills only empty planning cells
  - never overwrites existing user-entered text
  - seeds future workdays (1-year horizon)
- Disable/Delete flow supports a **Final Day** cutoff:
  - occurrences after that date are removed for that template
  - manual edits remain untouched
- The Templates tab also includes planner block template controls:
  - Daily Log block labels + optional secondary block toggle
  - Weekly Review header labels + default body template
  - Monthly Review header labels + prompt list
- Weekly/monthly template updates apply from current week/month onward by date boundary, while past periods keep prior defaults.

## PTO & Events Tracker

### Public Holidays

- Fields: name, date, status, notes.
- Includes user-selected country + province/state import (external public holiday feed).
- Import is date-deduplicated: existing holiday dates are not duplicated.
- For existing dates, import metadata is appended into the row notes instead of creating another row.
- Built app requirement: holiday import endpoint (`date.nager.at`) must be present in Tauri CSP/capability allowlists.
- Long weekend is auto-derived:
  - if holiday falls on Monday or Friday, a `Long Weekend` chip is shown.

### Personal PTO

- Fields: description, start date, end date, days total, days taken, status, notes.
- Sync: weekdays in the inclusive range are marked as `PTO`.

### Conferences

- Fields: event name, start date, end date, location, activity, status, notes.
- Sync: weekdays in the inclusive range are marked as `Off-site / Conference`.

### Office Trips

- Fields: trip name, start date, end date, location, activity, status, notes.
- Sync: weekdays in the inclusive range receive an office-trip banner.

## PTO Counter

- `Total Allocation` is editable.
- `PTO Remaining` is computed:
  - `total_allocation - sum(days_taken)`.

## Sync Engine Notes

- Tracker data is treated as source-of-truth for tracked dates.
- Tracker-controlled cells include an `Edit Event` jump back to the relevant tracker row.
- Date-only values (`YYYY-MM-DD`) are parsed as **local** dates to avoid timezone weekday drift.

## Markdown Toolbar in Planner

- On **Weekly Review**, **Monthly Review**, **Templates**, and **Goals** tabs, the same formatting toolbar as the note editor appears above the scroll region.
- Toolbar actions apply to whichever `PlannerCodeMirrorField` last received focus (shared `EditorView` ref).

## Monthly Review Layout

- Monthly reviews are shown on one consolidated page per year (all 12 months visible together).
- Each month uses three columns: month label · **Issues Encountered** (`monthly_review.content`, seeded from template prompts — prompts are not duplicated as a separate read-only list) · **Monthly Achievements** (`monthly_review.achievements`) on the **right**.
- Stored per month: `monthly_review.content`, `monthly_review.achievements`, and optional `monthly_review.date_completed` metadata.
- Prompt template changes influence current/future months that have not been manually edited.

### Earlier Monthly Layout Notes

- Older builds exposed a read-only “Last Friday of the month” panel beside the reflection field; that duplicate panel was removed in favour of the editable columns above.
- Older builds duplicated template prompts as a non-editable bullet list above **Issues Encountered**; prompts now seed only the editable markdown field.