# User guide

[← Back to the README](../README.md)

## Contents
1. [The Clean page](#the-clean-page)
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

The sidebar shows **Clean**, **Activity** and **Settings**, and **More**, which opens Projects, Tools & SDKs, the storage map, the dependency map and cleanup rules. Turn on **Settings → Appearance → Show advanced tools** to keep Projects and Tools & SDKs in the sidebar and see every setting; this changes only what is shown, never what can be removed. The bottom of the sidebar shows when you last cleaned, free disk space, an amber **Dry run** note when nothing will be deleted, and **Commands**.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+K or / | Search projects |
| Ctrl/Cmd+Shift+P | Command palette: scan, open a page, toggle dark mode or dry run, About |
| Ctrl/Cmd+R | Scan (or stop) on Clean, Projects and Tools & SDKs |
| Ctrl/Cmd+A | Select everything visible (press again to clear) |
| Ctrl/Cmd+, | Open Settings |
| Esc | Close the panel, then clear the selection |
| Delete | Clean the selection (asks first) |

On first launch a single welcome screen asks for your project folders. Once something is selected, a bar at the bottom shows the size and the button **Move X to Trash** (or **Delete X permanently** in that mode). Every folder lands in one group: **Safe to clean**, **Worth a look** or **Leaving alone**, with one line under its name saying why. After a complete scan, every Safe to clean folder is ticked for you (only in Trash mode; nothing is ticked for permanent deletion).

## The Clean page
The app opens on **Clean**. Press **Scan** and it checks your project folders and your tools' caches at the same time.

- **Scan status.** One line per source, Projects and Tools & SDKs, says Scanning, Done, Partial (stopped, a scan folder is missing, or something could not be measured) or Failed with the reason, with **Try again**. A source that did not finish is never shown as an empty, clean result.
- **The headline** is the space in **Safe to clean**, marked as an estimate, with **Worth a look** beside it.
- **Three groups.** Dev Cleaner's engine puts every item in exactly one: **Safe to clean** (open, and ticked after a complete scan in Trash mode), **Worth a look** (closed; tick what you want) and **Leaving alone** (closed; nothing there can be ticked from this page). An item the engine has no verdict for is always Leaving alone. Opening or closing a group, or opening an item's details, never changes what is ticked.
- **Details.** Click a row for a short panel: size, what happens if you remove it, how to get it back and where it is. **Why it is safe to clean** and **Technical details** open the full reasons and numbers.
- **Cleaning.** One button covers projects and tools together, and one dialog confirms it. In Trash mode it says the items move to the Trash and that the space comes back when the Trash is emptied.
- **Undo.** The result line after a move to Trash has an **Undo** button that restores exactly what was just moved. It never overwrites a folder that has been recreated since.

The **Projects** and **Tools & SDKs** pages are still there for filters, the storage map, the dependency map and picking parts.

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
Each row shows the folder, its type, **size on disk**, file count, its group (**Safe to clean**, **Worth a look**, **Leaving alone**) and one plain sentence on why. A lock means it cannot be selected (**Protected**, **Tracked by Git**, **System folder**, **Contains signing keys**, **Not removable**). Hover the group to see the reasons; the details panel lists every check, and its Advanced details show risk, confidence and score.

The big number at the top is what you can safely clean: an estimate that counts only Safe to clean items. Worth a look items are shown next to it and never added in. On Tools & SDKs, Docker and WSL are listed once under the list as "shown, not cleaned" and are left out of every total.

- **Size on disk** is what you actually get back. Apparent size (the sum of file sizes) is in the details panel.
- **Project used** is the newest change anywhere in the project, not only in the folder. A project you touched yesterday is probably live.
- Click a row to open the **details panel**: why it is (or is not) recommended, what the folder is, why it was detected (marker files, lock files, Git), what happens if you remove it and how to get it back (with the right command for your package manager), the cost (risk, rebuild time, downloads, confidence, Git status, last activity), storage details including the estimated reclaim, and a button to show it in your file manager.
- **In use now** means a running program (a dev server, a build, a Gradle daemon, an emulator) or a locked file uses the folder. Close it first, or confirm to remove it anyway.
- Folders inside a monorepo are grouped under the workspace root (pnpm, npm, Yarn, Lerna, Cargo, Gradle, Go, Dart or Melos), and the row shows the package they belong to.
- Rust `target` and similar split folders list their parts as **Active** (changed today or a build is running), **Used recently** (last 14 days) or **Not used recently**, so you can remove old `release` output and keep the `debug` build you are using.
- **Estimated reclaim** leaves out files that are hard-linked from elsewhere (pnpm and some caches do this), since removing them frees nothing.

### Views and filters
- **By project** groups rows under their project. **Flat** is one sorted list. **Map** is a treemap where area is size.
- Search by path or type, filter by type, verdict, Git status, minimum size (MB) and minimum idle days, and hide folders with warnings or protected folders.
- **Quick select** ticks every visible item that fits a profile: **No downloads** (Safe to clean items that come back without downloading), **Safe to clean**, or **Safe + worth a look**. It never ticks Leaving alone items.
- Click a column header to sort.
- **Expand all / Collapse all** (next to the view switcher) opens or closes every project group and every folder's parts in one click. The button flips to show what the next click does. You can also open a single group or the arrow on a row. The same button is in the Tools & SDKs page.

## The Tools & SDKs page
Same states as Projects. Results are grouped by ecosystem (Android, Node.js, Rust and so on), with *View only* locations last, sorted by size. Only caches that exist on your computer are shown. Click a row for the same details panel as Projects.

Scan your projects first. SDK platforms, build tools, NDKs, Rust toolchains, FVM Flutter versions and Gradle distributions are then marked **Used by N projects**, **Not used by scanned projects** or **Usage unknown**, and versions in use land in Leaving alone.

Switch **View** to **Dependency map** to see each installed version (Android platforms, build-tools and NDKs, Rust toolchains, FVM Flutter versions, Gradle distributions) with the projects that use it. Versions a project asks for but that are not installed are listed too. **Select N unused** ticks the versions no scanned project uses. It is not offered when a project does not pin a version, since that project could use any of them.

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
2. Press **Move to Trash** (or **Delete permanently**). Dev Cleaner checks every selected item again. If **Ask before removing** is on, or anything needs attention, a dialog shows the estimated space, how much may be downloaded again, how many projects are affected, the scan's age, the exact folders, and anything that will be skipped and why.
3. Confirm. Folders go to the Trash (default) or are deleted permanently, depending on **Settings → Cleaning**. Each item is checked once more right before it is removed; anything that changed since the scan is skipped.
4. A result line says how many items moved (for example "Moved 3 of 4 items to Trash") with **Undo** and **Details**. A move to the Trash frees no space until the Trash is emptied, so it is never reported as reclaimed. The details show the estimate (and, for permanent deletion, how much free space actually grew), with removed, failed, blocked and skipped items listed separately with their reasons. The usual reason for a failure is a file in use by an editor or dev server.

With **Dry run** on, the same flow runs but nothing is touched.

## Where removed folders go, and getting them back
In **Move to Trash** mode (the default) folders go to your operating system's Trash:

| System | Where | Open it |
| --- | --- | --- |
| Windows | Recycle Bin | Desktop icon, or **Open** in Activity → Manage Trash |
| macOS | `~/.Trash` (the Trash in the Dock) | Dock, or **Open** |
| Linux | `~/.local/share/Trash` (on other drives, a `.Trash-<id>` folder at the drive root) | File manager, or **Open** |

In **Delete permanently** mode nothing goes to the Trash and it cannot be undone.

### Activity (Windows and Linux)
**Activity** lists every cleanup, newest first: how many items, how much, and how many are still in the Trash. **Restore** on a cleanup puts back everything from it that is still in the Trash; open **Show items** to restore one at a time. Restore never replaces a folder that exists again at the original path; that item is reported and left in the Trash.

With advanced tools on, **Manage Trash** lists the folders themselves: size, when they were removed, where they will be restored to, and when they will be cleared automatically.

- **Restore** (per row, or **Restore selected**) puts the folder back at its original path. If something already exists there, or the parent folder is gone, the result dialog explains and nothing is lost.
- **Delete forever** removes the selected items from the Trash for good, after a confirmation.
- Only folders Dev Cleaner removed are listed or touched. Other things in your Trash are never shown or deleted.
- After restoring, rescan so the folder appears in the list again.

### Automatic clearing
**Settings → Cleaning → Empty from the Trash after** sets how many days items stay (Never, 7, 30 or 90 days; any number in the advanced Trash section; default 30). The app checks when it opens and every hour while it is running, and removes only items older than that. Items already restored are not affected. Set it to 0 / Never to keep everything until you delete it yourself. Manage Trash shows each item's remaining time. To keep one item longer, press **Change** in its Auto-clear column and pick 30 or 90 more days, or *Until I delete it*. The app has to be running for cleanup to happen.

### macOS
macOS does not let apps list or restore the Trash, so Activity lists your cleanups and offers **Open Trash** instead of Restore. In Finder, right-click an item and choose **Put Back**. Auto-clear is not available; use Finder's "Remove items from the Trash after 30 days" setting (Finder → Settings → Advanced) instead.

## History
Activity shows every cleanup. With advanced tools on, **Report** lists every removal with time, path, project, kind, how it was removed and the estimated space freed. The top shows the total reclaimed. Open **Over time** for the space reclaimed per month over the last year, the kinds of folders that freed the most, and how the reclaimable total changed between scans.

## Scheduled cleanup
Off by default. Turn it on in **Settings → Cleaning → Scheduled cleanup**. While the app is open it rescans your project folders every day, week, two weeks or month. It then tells you what could be reclaimed, or, if you chose *Move to Trash*, moves the items that need no confirmation to the Trash. It never deletes permanently.

## Where your data is stored
Settings and history are plain files, safe to back up or delete:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\com.devcleaner.app\` |
| macOS | `~/Library/Application Support/com.devcleaner.app/` |
| Linux | `~/.config/com.devcleaner.app/` |

Files: `settings.json`, `history.jsonl` (one line per removed item), `operations.jsonl` (one full report per cleanup, including failures and error codes) and `scans.jsonl` (one line per scan). Deleting `settings.json` restores defaults.
