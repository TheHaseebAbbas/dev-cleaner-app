# Dev Cleaner (desktop)

Interactive desktop version of [jemishavasoya/dev-cleaner](https://github.com/jemishavasoya/dev-cleaner).
Tauri 2 (Rust) backend + React/TypeScript UI. One codebase for macOS, Windows and Linux.

## What it does
- Scans your project folders for rebuildable artifacts: `node_modules`, `.next`, Rust `target`, Flutter `build`/`.dart_tool`, `Pods`, Gradle, Python venvs and caches, .NET `bin`/`obj`, Unity `Library` and more (25 built-in rules). A folder only matches when its project marker exists (e.g. `package.json` for `node_modules`), so unrelated `target` or `build` folders are left alone.
- Shows size on disk, apparent size, file and folder counts, last modified, project last-active date, git-ignored status, risk level and how to restore each folder.
- Clear scope: a banner shows which folders are scanned, a "How it works" panel explains every rule, and the confirm dialog lists the exact folders to be removed.
- Optional parts: folders that are made of independent pieces (Rust `target/debug` vs `release`, Flutter `build/android` vs `ios`, per-version Gradle and Xcode caches, one simulator, one Flutter SDK...) can be expanded and removed one by one.
- Table (sortable, filterable by ecosystem / size / idle days / git-safe) and treemap views.
- Global caches tab: npm, Cargo, Gradle, Maven, pub, pip, NuGet, Xcode DerivedData, CocoaPods, Homebrew, Android AVDs, old Claude Code versions.
- Safe deletion: Trash by default, dry-run mode, confirmation, protected paths, only paths from the last scan can be deleted, never home or root, symlinks refused.
- Settings: scan folders, excluded names, protected paths, per-rule toggles, custom rules, delete mode, depth, theme.
- History log with total space reclaimed.

## Setup guides
Step-by-step: [Windows](docs/WINDOWS_SETUP.md) · [macOS](docs/MACOS_SETUP.md) · [Linux](docs/LINUX_SETUP.md)

## Develop
```bash
npm install
npm run tauri dev        # run the app
cargo test -p dev_cleaner_core
npm run tauri build      # installers
```
Linux needs the Tauri prerequisites (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `libxdo-dev`).

## Layout
- `core/` pure Rust library (rules, scanner, cleaner, settings, history, global caches) with tests
- `src-tauri/` Tauri commands wrapping the core
- `src/` React UI
