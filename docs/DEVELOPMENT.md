# Developer guide

[← Back to the README](../README.md)

## Contents
1. [Prerequisites](#prerequisites)
2. [Set up and run](#set-up-and-run)
3. [Project layout](#project-layout)
4. [Architecture](#architecture)
5. [Adding a rule or a cache](#adding-a-rule-or-a-cache)
6. [Tests and checks](#tests-and-checks)
7. [Working on the UI without the desktop shell](#working-on-the-ui-without-the-desktop-shell)
8. [Building releases](#building-releases)
9. [The app icon](#the-app-icon)
10. [Conventions](#conventions)

## Prerequisites
| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20 or newer | with npm |
| Rust | stable | install with rustup |
| Tauri system libraries | | OS specific, see below |

Step by step installs, with screenshots-level detail, are in the guides for [Windows](WINDOWS_SETUP.md), [macOS](MACOS_SETUP.md) and [Linux](LINUX_SETUP.md). In short:

- **Windows:** Microsoft C++ Build Tools (Desktop development with C++) and WebView2. If PowerShell blocks npm, see the script policy fix in the Windows guide.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`).
- **Linux (Debian/Ubuntu):** `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libxdo-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev`.

## Set up and run
```bash
git clone https://github.com/TheHaseebAbbas/dev-cleaner-app.git
cd dev-cleaner-app
npm install
npm run tauri dev
```
The first run compiles the Rust crates and takes a few minutes. Later runs are fast. Frontend edits hot-reload; Rust edits restart the app.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run tauri dev` | Desktop app with hot reload |
| `npm run dev` | UI only, in a browser at http://localhost:1420 (no backend, see below) |
| `npm run build` | Type-check and build the UI into `dist/` |
| `cargo test -p dev_cleaner_core` | Core library tests |
| `cargo check -p dev-cleaner-app` | Compile the Tauri shell |
| `npm run tauri build` | Installers for the current OS |

## Project layout
```
core/                  Pure Rust library, no Tauri dependency, fully tested
  src/rules.rs         Built-in rules and descriptions
  src/scanner.rs       Discovery, sizing, git state, warnings, progress
  src/global.rs        Tool cache table, OS-aware locations, parts, view-only items
  src/cleaner.rs       Safe deletion (Trash / permanent / dry run)
  src/settings.rs      Settings and defaults
  src/history.rs       Append-only history log
  src/tests.rs         Tests
src-tauri/             Tauri shell
  src/lib.rs           Commands and events
  tauri.conf.json      Window, bundle and icon config
  capabilities/        Permissions for the frontend
  icons/               Generated app icons
src/                   React UI
  App.tsx              Shell: sidebar, theme, scans kept at app level
  api.ts               Types and typed wrappers around the Tauri commands
  hooks/useScans.ts    Scan state machines (idle, scanning, done, stopped, error)
  views/               Projects, GlobalView (tool caches), History, SettingsView
  components/          Tree rows, ScanPanel, SelectionBar, dialogs, Details, Treemap
  ui/                  Primitives (Badge, Toggle, Modal...), icons, warning components
public/icon.svg        Logo used in the sidebar
app-icon.svg           Source for generated icons
```

## Architecture
The Rust `core` knows nothing about the UI. `src-tauri` exposes it as commands and streams progress as events.

```
React view ──invoke──▶ Tauri command ──▶ core
     ▲                      │
     └────── events ◀───────┘   (scan-item, scan-progress, scan-done,
                                 global-item, global-progress, global-done)
```

**Scanning.** `scan_with_progress` walks the scan folders (pruning skipped names and matched folders), matches rules by folder name plus marker files, then measures matches in parallel (rayon). Each finished item is emitted immediately, so rows appear while the scan runs. The frontend batches incoming items to one state update per animation frame.

**Global caches.** `global.rs` has a table of definitions (`Def`) with an OS, a base (`Home`, `LocalData`, `Data`, `AndroidSdk`), a relative path and flags (`split` for parts, `parts_only`, `info_only`, `allow` whitelist, warnings). `scan_global_caches` resolves them for the current OS, measures the ones that exist, and streams them.

**State machines.** `useScan` and `useGlobalScan` keep `status` (`idle`, `scanning`, `done`, `stopped`, `error`), the items, progress, a summary, and an error. Views render from that status, so every state has its own component. The hooks live in `App` so switching tabs never loses a scan.

**Deletion.** `delete_items` and `delete_global_caches` accept only paths from the last scan (or parts under them), refuse protected, view-only, home, root and symlink targets, and call `cleaner::delete_one`, which records history.

**Warnings.** `scanner::assess` (projects) and the `.warn()` entries of `global.rs` produce `Warning { level: caution | danger, message }`. The UI shows badges and requires an acknowledgement for `danger`.

**Data files.** `settings.json` and `history.jsonl` in the app config directory.

## Adding a rule or a cache

### A project rule
In `core/src/rules.rs` add a line in `builtin_rules()`:
```rust
rule("id", "Display name", "Ecosystem", &["folder"], &["marker.file"], &[], "restore command", Low),
```
Arguments: id, name, ecosystem, folder names, parent marker files, self marker files (files that must exist inside the folder), restore command, risk. Then:
1. Add a description in `describe()` and set `split` to true there if its direct children are independent.
2. Add a test in `core/src/tests.rs` (see the existing scan tests: create a temp project, scan, assert).
3. Add the row to [RULES.md](RULES.md).

Always give a parent marker unless the folder name is unmistakable.

### A tool cache
In `core/src/global.rs` add a `d(...)` line to `TABLE`:
```rust
d("id", "Name", "Category", "windows|macos|linux|unix|all", Home, "relative/path", "what happens if removed", split)
```
Chain modifiers as needed: `.warn(Danger, "message")`, `.only(&["names"])` for a whitelist, `.info()` for view only, or wrap with `parts_only(...)`. Add a test, and add the row to [RULES.md](RULES.md).

### A warning
Project warnings go in `scanner::assess`. Keep messages in plain language and say what to do.

## Tests and checks
```bash
cargo test -p dev_cleaner_core      # scanner, deletion safety, parts, warnings, locations
cargo check -p dev-cleaner-app      # shell compiles
npm run build                       # TypeScript strict check and bundle
```
Run all three before opening a pull request. Core tests use temporary directories, so they never touch your files.

## Working on the UI without the desktop shell
`npm run dev` opens the UI in a browser, but there is no Tauri backend, so every `invoke` fails. To explore states, mock `window.__TAURI_INTERNALS__.invoke` (and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`) with Playwright's `addInitScript`, answering `get_settings`, `start_scan` (then emit `scan-item`, `scan-progress`, `scan-done` through the registered event handlers) and so on. This is how the UI states were checked.

## Building releases
```bash
npm run tauri build
```
Outputs are in `target/release/bundle/` (the Cargo workspace puts `target/` at the repository root):

| OS | Output |
| --- | --- |
| Windows | `.msi` and `.exe` (NSIS) installers |
| macOS | `.app` and `.dmg` |
| Linux | `.deb`, `.rpm` and `.AppImage` |

Build on each target OS (Tauri does not cross-compile bundles). Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` together. Code signing and notarization (macOS) or signing certificates (Windows) are needed to avoid OS warnings for public releases; see the Tauri distribution docs.

## The app icon
The source is `app-icon.svg` (a folder with a broom). Regenerate every size and format after changing it:
```bash
npx tauri icon app-icon.svg
rm -rf src-tauri/icons/android src-tauri/icons/ios   # not used
cp app-icon.svg public/icon.svg
```
This writes the PNGs, `icon.ico` (Windows) and `icon.icns` (macOS) into `src-tauri/icons/`.

## Conventions
- UI text is plain language for non-experts: say "folder", "remove", "comes back with". Avoid jargon in labels.
- Every list shares the column grid in `components/Tree.tsx`. Reuse `TreeRow`, `GroupHeader`, `ScanPanel`, `EmptyState`, `Banner` instead of writing new markup.
- Tailwind v4 with dark mode through the `dark` class. Use the shared classes in `src/index.css` (`btn`, `input`, `card`, `muted`).
- Any new way to delete must go through `cleaner::check_target` and the "only scanned paths" rule.
- Rust: `cargo fmt` and no new warnings.
