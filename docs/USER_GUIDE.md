# User guide

[← Back to the README](../README.md)

## Contents
1. [How the app decides what to show](#how-the-app-decides-what-to-show)
2. [The Projects page](#the-projects-page)
3. [The Tools & SDKs page](#the-tools--sdks-page)
   - [Where removed folders go, and getting them back](#where-removed-folders-go-and-getting-them-back)
4. [Removing only part of a folder](#removing-only-part-of-a-folder)
5. [Warnings](#warnings)
6. [Cleaning](#cleaning)
7. [History](#history)
8. [Where your data is stored](#where-your-data-is-stored)

## Getting around

The sidebar groups the app into **Clean** (Projects, Tools & SDKs), **Manage** (Trash, History) and **Configure** (Settings). The bottom of the sidebar shows free disk space, an amber **Dry run** note when nothing will be deleted, and **About**.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+K | Command palette: scan, open a page, toggle dark mode or dry run, About |
| Ctrl/Cmd+R | Scan (or stop) on Projects and Tools & SDKs |
| Ctrl/Cmd+A | Select everything visible (press again to clear) |
| Ctrl/Cmd+F | Search projects |
| Ctrl/Cmd+, | Open Settings |
| Esc | Close the panel, then clear the selection |
| Delete | Reclaim the selection (asks first) |

On first launch a single welcome screen asks for your project folders. Once something is selected, a bar at the bottom shows the size and the button **Reclaim X**. Every folder gets a verdict (**Recommended**, **Review** or **Keep**), and folders are labelled **Check first** or **May be required** when they need care.

## How the app decides what to show
Dev Cleaner works from **rules**. A rule says "a folder with this name counts only if this marker file is next to it". For example `node_modules` counts only beside a `package.json`, and Rust's `target` only beside a `Cargo.toml`. A plain folder that happens to be called `build` or `target` is left alone.

- **Projects page:** looks only inside the **scan folders** you set. Nothing outside them is read.
- **Tools & SDKs page:** looks only at a fixed list of known locations for your operating system (for example `%LOCALAPPDATA%` on Windows). The **Where it looks** button shows every path and whether it exists.

You can see both lists at any time with the eye button or **Where it looks**. The full rule list is in [Rules and locations](RULES.md).

## The Projects page

### States
| State | What you see | What you can do |
| --- | --- | --- |
| No scan folders | A prompt to choose a folder | Open Settings and add one |
| Ready | The folders that will be scanned and a **Scan projects** button | Scan, see where it looks, read how it works |
| Scanning | A progress card (what it is doing, folders checked, found so far, time) with rows appearing live | Stop the scan; keep browsing results |
| Results | Totals, filters, the list, a details panel and a selection bar | Select, filter, sort, clean |
| Stopped (partial scan) | The results found so far, with a notice that sizes may be incomplete. Cleaning is turned off until a full scan finishes | Scan again |
| Nothing found | A friendly empty page with the reason and next steps | Rescan, change settings |
| Filtered out | "No folders match these filters" | Clear filters |
| Error | A red notice with the message | Retry |
| Removing | The selection bar shows a spinner | Wait; a result dialog follows |

Switching to another page does not cancel a scan. Come back and the results are still there.

### Reading the list
Each row shows the folder, its type, **size on disk**, file count, and badges: the verdict (**Recommended**, **Review**, **Keep**), a lock when it cannot be selected (**Protected**, **Tracked by Git**, **System folder**, **Contains keys**), **Danger** or **Critical** risk, and warnings. Hover a verdict to see its score and reasons.

The numbers at the top are the reclaimable total (blocked items excluded), how much is Recommended, how many items need review, and how many are protected.

- **Size on disk** is what you actually get back. Apparent size (the sum of file sizes) is in the details panel.
- **Project used** is the newest change anywhere in the project, not only in the folder. A project you touched yesterday is probably live.
- Click a row to open the **details panel**: why it is (or is not) recommended, what the folder is, why it was detected (marker files, lock files, Git), what happens if you remove it and how to get it back (with the right command for your package manager), the cost (risk, rebuild time, downloads, confidence, Git status, last activity), storage details including the estimated reclaim, and a button to show it in your file manager.
- **Estimated reclaim** leaves out files that are hard-linked from elsewhere (pnpm and some caches do this), since removing them frees nothing.

### Views and filters
- **By project** groups rows under their project. **Flat** is one sorted list. **Map** is a treemap where area is size.
- Search by path or type, filter by type, verdict, Git status, minimum size (MB) and minimum idle days, and hide folders with warnings or protected folders.
- **Quick select** ticks every visible item that fits a profile: **Safe** (Recommended items that rebuild without downloads), **Recommended**, or **Deep** (Recommended and Review). It never ticks Keep or protected items.
- Click a column header to sort.
- **Expand all / Collapse all** (next to the view switcher) opens or closes every project group and every folder's parts in one click. The button flips to show what the next click does. You can also open a single group or the arrow on a row. The same button is in the Tools & SDKs page.

## The Tools & SDKs page
Same states as Projects. Results are grouped as *Package & build caches*, *SDKs & toolchains*, *IDE caches*, *Developer state* (emulators, simulators, archives), *Temporary data* and *View only*, sorted by size. Only caches that exist on your computer are shown. Click a row for the same details panel as Projects.

Scan your projects first. SDK platforms, build tools, NDKs, Rust toolchains, FVM Flutter versions and Gradle distributions are then marked **Used by N projects**, **Not used by scanned projects** or **Usage unknown**, and versions in use are marked Keep.

Items marked **View only**, such as Docker Desktop's disk image, are never deletable from the app. The note beside them explains the safe way to shrink them (for example `docker system prune`).

## Removing only part of a folder
Rows with a **N parts** badge have an arrow on the left. Open it and the parts appear underneath, drawn as a tree. Each part is independent, so you can tick just those you want.

Examples:
- Rust `target`: `debug` and `release` separately.
- Flutter `build`: `android`, `ios`, `web` and others separately.
- Gradle wrapper: one Gradle version per part.
- Android SDK platforms: one API level per part.
- Xcode simulators: one simulator per part.

Ticking the parent row selects the whole folder and locks its parts (they are covered). If any part is blocked (for example the Claude Code version you are running, or Temp files changed in the last week), the parent cannot be ticked and you choose parts one at a time. A half-filled checkbox on the parent means some parts are ticked. **Select all** and **Clear** sit at the top of the parts list.

## Warnings
Two levels appear as badges and again in the confirm dialog:

- **Check first** (amber): usually fine, but look first. Examples: the folder is not in `.gitignore`, the project changed in the last few days, or other projects may use that SDK version.
- **May be required** (red): removing it can break something or lose data. Examples: a `.env` or key file inside, a Python environment with no `requirements.txt`, your default Rust toolchain. Items with **Danger** or **Critical** risk (SDK versions, emulators, simulators, archives) are treated the same way. The confirm button stays disabled until you tick **I understand**. Deleting Critical items permanently also asks you to type DELETE.

Folders Git tracks, system folders and folders holding signing keys are not warnings: they are blocked and cannot be selected.

More in [Safety](SAFETY.md).

## Cleaning
1. Tick rows or parts. The bar at the bottom shows how many and how much.
2. Press **Reclaim**. Dev Cleaner checks every selected item again. If **Ask before removing** is on, or anything needs attention, a dialog shows the estimated space, how much may be downloaded again, how many projects are affected, the scan's age, the exact folders, and anything that will be skipped and why.
3. Confirm. Folders go to the Trash (default) or are deleted permanently, depending on **Settings → Cleaning**. Each item is checked once more right before it is removed; anything that changed since the scan is skipped.
4. A result dialog shows the estimated space reclaimed (and, for permanent deletion, how much free space actually grew), with removed, failed, blocked and skipped items listed separately with their reasons. The usual reason for a failure is a file in use by an editor or dev server.

With **Dry run** on, the same flow runs but nothing is touched.

## Where removed folders go, and getting them back
In **Move to Trash** mode (the default) folders go to your operating system's Trash:

| System | Where | Open it |
| --- | --- | --- |
| Windows | Recycle Bin | Desktop icon, or the **Open** button in the Trash page |
| macOS | `~/.Trash` (the Trash in the Dock) | Dock, or **Open** |
| Linux | `~/.local/share/Trash` (on other drives, a `.Trash-<id>` folder at the drive root) | File manager, or **Open** |

In **Delete permanently** mode nothing goes to the Trash and it cannot be undone.

### The Trash page (Windows and Linux)
Lists the folders Dev Cleaner removed, newest first: size, when they were removed, where they will be restored to, and when they will be cleared automatically.

- **Restore** (per row, or **Restore selected**) puts the folder back at its original path. If something already exists there, or the parent folder is gone, the result dialog explains and nothing is lost.
- **Delete forever** removes the selected items from the Trash for good, after a confirmation.
- Only folders Dev Cleaner removed are listed or touched. Other things in your Trash are never shown or deleted.
- After restoring, rescan so the folder appears in the list again.

### Automatic clearing
**Settings → Trash → Clear automatically after** sets how many days items stay (Never, 7, 14, 30, 90, or any number; default 30). The app checks when it opens and every hour while it is running, and removes only items older than that. Items already restored are not affected. Set it to 0 / Never to keep everything until you delete it yourself. The Trash page shows each item's remaining time. The app has to be running for cleanup to happen.

### macOS
macOS does not let apps list or restore the Trash, so the Trash page only offers **Open Trash**. In Finder, right-click an item and choose **Put Back**. Auto-clear is not available; use Finder's "Remove items from the Trash after 30 days" setting (Finder → Settings → Advanced) instead.

## History
Every removal is logged with time, path, project, kind (category and risk), how it was removed and the estimated space freed. The top shows the total reclaimed.

## Where your data is stored
Settings and history are plain files, safe to back up or delete:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\com.devcleaner.app\` |
| macOS | `~/Library/Application Support/com.devcleaner.app/` |
| Linux | `~/.config/com.devcleaner.app/` |

Files: `settings.json`, `history.jsonl` (one line per removed item), `operations.jsonl` (one full report per cleanup, including failures and error codes) and `scans.jsonl` (one line per scan). Deleting `settings.json` restores defaults.
