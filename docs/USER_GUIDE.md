# User guide

[← Back to the README](../README.md)

## Contents
1. [How the app decides what to show](#how-the-app-decides-what-to-show)
2. [The Projects tab](#the-projects-tab)
3. [The Tool caches tab](#the-tool-caches-tab)
4. [Removing only part of a folder](#removing-only-part-of-a-folder)
5. [Warnings](#warnings)
6. [Cleaning](#cleaning)
7. [History](#history)
8. [Where your data is stored](#where-your-data-is-stored)

## How the app decides what to show
Dev Cleaner works from **rules**. A rule says "a folder with this name counts only if this marker file is next to it". For example `node_modules` counts only beside a `package.json`, and Rust's `target` only beside a `Cargo.toml`. A plain folder that happens to be called `build` or `target` is left alone.

- **Projects tab:** looks only inside the **scan folders** you set. Nothing outside them is read.
- **Tool caches tab:** looks only at a fixed list of known locations for your operating system (for example `%LOCALAPPDATA%` on Windows). The **Where it looks** button shows every path and whether it exists.

You can see both lists at any time with the eye button or **Where it looks**. The full rule list is in [Rules and locations](RULES.md).

## The Projects tab

### States
| State | What you see | What you can do |
| --- | --- | --- |
| No scan folders | A prompt to choose a folder | Open Settings and add one |
| Ready | The folders that will be scanned and a **Scan now** button | Scan, see where it looks, read how it works |
| Scanning | A progress card (what it is doing, folders checked, found so far, time) with rows appearing live | Stop the scan; keep browsing results |
| Results | Totals, filters, the list, a details panel and a selection bar | Select, filter, sort, clean |
| Stopped | The results found so far, with a notice that sizes may be incomplete | Scan again |
| Nothing found | A friendly empty page with the reason and next steps | Rescan, change settings |
| Filtered out | "No folders match these filters" | Clear filters |
| Error | A red notice with the message | Retry |
| Removing | The selection bar shows a spinner | Wait; a result dialog follows |

Switching to another tab does not cancel a scan. Come back and the results are still there.

### Reading the list
Columns: folder, type, **size on disk**, file count, when the project was last used, and notes (protected, warnings, tracked by git).

- **Size on disk** is what you actually get back. Apparent size (the sum of file sizes) is in the details panel.
- **Project used** is the newest change anywhere in the project, not only in the folder. A project you touched yesterday is probably live.
- Click a row to open the **details panel**: what the folder is, the exact path that would be removed, git status, how it comes back, and a button to show it in your file manager.

### Views and filters
- **By project** groups rows under their project. **Flat** is one sorted list. **Map** is a treemap where area is size.
- Search by path or type, filter by type, minimum size (MB), minimum idle days, and "only git-ignored".
- Click a column header to sort.

## The Tool caches tab
Same states as Projects. Results are grouped by category (Node.js, Rust, Android SDK, IDEs, and so on) and sorted by size. Only caches that exist on your computer are shown.

Items marked **View only**, such as Docker Desktop's disk image, are never deletable from the app. The note beside them explains the safe way to shrink them (for example `docker system prune`).

## Removing only part of a folder
Rows with a **N parts** badge have an arrow on the left. Open it and the parts appear underneath, drawn as a tree. Each part is independent, so you can tick just those you want.

Examples:
- Rust `target`: `debug` and `release` separately.
- Flutter `build`: `android`, `ios`, `web` and others separately.
- Gradle wrapper: one Gradle version per part.
- Android SDK platforms: one API level per part.
- Xcode simulators: one simulator per part.

Ticking the parent row selects the whole folder and locks its parts (they are covered). A half-filled checkbox on the parent means some parts are ticked. **Select all** and **Clear** sit at the top of the parts list.

## Warnings
Two levels appear as badges and again in the confirm dialog:

- **Check first** (amber): usually fine, but look first. Examples: the folder is not in `.gitignore`, the project changed in the last few days, or other projects may use that SDK version.
- **May be required** (red): removing it can break something or lose data. Examples: the folder is tracked by git, a Python environment with no `requirements.txt`, your default Rust toolchain, emulators, Xcode archives. The confirm button stays disabled until you tick **I understand**.

More in [Safety](SAFETY.md).

## Cleaning
1. Tick rows or parts. The bar at the bottom shows how many and how much.
2. Press **Clean selected**. If **Ask before removing** is on, or any selected item is red, a dialog lists the exact folders.
3. Confirm. Folders go to the Trash (default) or are deleted permanently, depending on **Settings → Cleaning**.
4. A result dialog shows how much was freed and lists any folder that could not be removed with the reason. The usual reason is a file in use by an editor or dev server.

With **Dry run** on, the same flow runs but nothing is touched.

## History
Every removal is logged with time, path, how it was removed and bytes freed. The top shows the total reclaimed.

## Where your data is stored
Settings and history are plain files, safe to back up or delete:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\com.devcleaner.app\` |
| macOS | `~/Library/Application Support/com.devcleaner.app/` |
| Linux | `~/.config/com.devcleaner.app/` |

Files: `settings.json` and `history.jsonl`. Deleting `settings.json` restores defaults.
