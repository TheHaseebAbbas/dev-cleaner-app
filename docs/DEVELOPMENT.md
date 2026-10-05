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
10. [Everyday development workflow](#everyday-development-workflow)
11. [Conventions](#conventions)

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
  src/model.rs         Shared vocabulary: Risk, Category, Cost, Confidence, GitStatus, Block, Recommendation, Usage, Fingerprint
  src/safety.rs        Path comparison, system and credential blocks, links/junctions/mounts, fingerprints, sensitive file names
  src/rules.rs         Built-in rules (versioned), custom rule limits
  src/scanner.rs       Discovery, project roots, hard-link-aware sizing, Git state, detection evidence, warnings, scan summary
  src/recommend.rs     Recommendation engine: verdict, score and reasons from the facts
  src/references.rs    Reads SDK/toolchain versions projects ask for (Gradle, rust-toolchain, FVM, Gradle wrapper)
  src/global.rs        Tool cache table, OS-aware locations, parts, usage, view-only items
  src/plan.rs          Turns a selection (scan id + ids) into validated targets; cleanup preview
  src/cleaner.rs       Delete gates, error codes, Trash / permanent / dry run, post-delete check
  src/settings.rs      Settings and defaults
  src/history.rs       history.jsonl, operations.jsonl, scans.jsonl
  src/trash_bin.rs     List, restore and purge items Dev Cleaner put in the OS Trash; expiry rules and per-item holds
  src/inuse.rs         Process snapshot and locked-file checks: is a folder in use right now
  src/workspace.rs     Monorepo workspace detection (pnpm, npm, Yarn, Lerna, Cargo, Gradle, Go, Dart, Melos)
  src/schedule.rs      Scheduled cleanup: when the next run is due and which items it may take
  src/ruletest.rs      Dry scan with a single rule, for the rule Test button
  src/graph.rs         Dependency map: installed SDK/toolchain versions and the projects that use them
  src/analytics.rs     Space reclaimed per month, by category and rule, and scan trend
  src/tests.rs         Tests
  src/tests_v2.rs      Tests for the safety model and recommendations
  src/tests_v3.rs      Tests for in-use detection, workspaces, schedule, holds, rule test, graph and analytics
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

The UI follows `Dev_Cleaner_UI_UX_v2_Specification.md`: Inter and JetBrains Mono are bundled with `@fontsource-variable`, the brand colour is indigo (emerald only for success, red only for danger), and the shell is a 232px sidebar plus a page header per view. Shortcuts and the command palette live in `src/App.tsx` and `src/components/CommandPalette.tsx`; views receive commands through `src/hooks/commands.ts`. The app version shown in About comes from `package.json` (Vite `define` as `__APP_VERSION__`), so bump it there and in `src-tauri/tauri.conf.json` together.
The Rust `core` knows nothing about the UI. `src-tauri` exposes it as commands and streams progress as events.

```
React view ──invoke──▶ Tauri command ──▶ core
     ▲                      │
     └────── events ◀───────┘   (scan-item, scan-progress, scan-done,
                                 global-item, global-progress, global-done)
```

**Scanning.** `scan_with_progress` walks the scan folders (pruning skipped names, matched folders and anything `safety::redirection` reports as a link, junction or mount), matches rules by folder name plus marker files, then measures matches in parallel (rayon). Every scan gets a `scan_id`, and every item and part an `id` (a hash of its path). Measuring is hard-link aware: `disk_bytes` counts each file once and `reclaimable_bytes` only counts files whose links are all inside the folder. `assess` then adds the Git status, detection evidence and confidence, warnings and blocks, and `recommend::recommend` adds the verdict. Each finished item is emitted immediately, so rows appear while the scan runs. The frontend batches incoming items to one state update per animation frame. `scan-done` carries a `ScanSummary` with counters, timings, skip reasons and the SDK references collected for the tools scan.

**Global caches.** `global.rs` has a table of definitions (`Def`) with an OS, a base (`Home`, `LocalData`, `Data`, `AndroidSdk`), a relative path and builder flags: `.parts()` (parts only), `.files()` (files are parts too), `.only()` / `.prefix()` / `.deny()` to limit which children are offered, `.info()` for view only, `.class(category, risk, rebuild, network)`, `.says(consequence, recovery)` and `.warn()`. `scan_global_caches` resolves them for the current OS, measures the ones that exist, checks SDK and toolchain versions against the last complete project scan (`references::Refs::usage_of`), and streams them.

**State machines.** `useScan` and `useGlobalScan` keep `status` (`idle`, `scanning`, `done`, `stopped`, `error`), the items, progress, a summary, and an error. Views render from that status, so every state has its own component. The hooks live in `App` so switching tabs never loses a scan.

**Deletion.** The backend is authoritative. `preview_cleanup` / `preview_global_cleanup` and `delete_items` / `delete_global_caches` take a `scan_id` and ids, never paths. `plan::resolve_items` / `resolve_globals` refuse an unknown, stopped or outdated scan, fold parts into a selected owner, and refuse view-only, parts-only and partly blocked targets. `cleaner::validate` then runs every gate again right before deleting (blocks, protected paths, system paths, links, junctions, fingerprint changes, acknowledgement for Danger and Critical), and `cleaner::execute` deletes, checks that the target is gone (`PARTIAL_CLEANUP` otherwise) and removes companions such as an AVD's `.ini`. Every outcome carries an `ErrorCode`. The command returns a `DeleteReport`; successes go to `history.jsonl` and the whole report to `operations.jsonl`.

**Warnings and blocks.** `scanner::assess` (projects) and the `.warn()` entries of `global.rs` produce `Warning { level: caution | danger, message }`; the UI requires an acknowledgement for `danger`. A `Block { source, reason }` makes an item unselectable and is enforced again at delete time.

**Recommendations.** `recommend::recommend(&Facts)` is a pure function: size, risk, rebuild and download cost, confidence, Git, idle days, usage and warnings give a verdict (`recommended`, `review`, `keep`, `blocked`), a 0 to 100 score and the reasons. Thresholds are `OLD_DAYS` (30) and `RECENT_DAYS` (3).

**Trash.** `trash_bin` uses the `trash` crate's `os_limited` API (Windows and Linux only) and shows only items that match a history entry, so it never touches other Trash content. A background thread in `src-tauri` purges expired items at start and hourly.

**Data files.** `settings.json`, `history.jsonl`, `operations.jsonl` and `scans.jsonl` in the app config directory. Settings → Diagnostics reads them through `get_diagnostics`.

## Adding a rule or a cache

### A project rule
In `core/src/rules.rs` add an `R { ... }` entry to `BUILTIN`. Fields: `id`, `name`, `eco`, `cat` (a `Category`), `dirs` (folder names), `parent` (marker files beside the folder; `*.ext` and `../name` allowed), `selfm` (files that must exist inside the folder), `conf` (optional files that raise confidence, such as lock files), `regen`, `risk` (`Safe` or `Caution`), `rebuild` and `net` (costs), `desc`, `consequence` and `split` (true if its direct children are independent parts). If you change what an existing rule matches, bump `RULES_VERSION`. Then:
1. Add a test in `core/src/tests.rs` or `tests_v2.rs` (create a temp project, scan, assert).
2. Add the row to [RULES.md](RULES.md).

Always give a parent marker unless the folder name is unmistakable.

### A tool cache
In `core/src/global.rs` add a `d(...)` line to `TABLE`:
```rust
d("id", "Name", "Ecosystem", "windows|macos|linux|unix|all", Home, "relative/path", "short note", split)
    .class(PackageCache, Caution, Low, High)
    .says("what happens if removed", "how to get it back")
```
Chain modifiers as needed: `.warn(Danger, "message")`, `.only(&["names"])` or `.prefix(&["Prefix"])` to limit which children are offered, `.deny(&[("name", "why")])`, `.parts()` for parts only, `.files()` to offer files as parts, `.info()` for view only. Add a test, and add the row to [RULES.md](RULES.md).

### A warning
Project warnings go in `scanner::assess`. Keep messages in plain language and say what to do.

## Tests and checks
```bash
cargo test -p dev_cleaner_core      # safety gates, scanner, recommendations, references, deletion, parts, locations
cargo check -p dev-cleaner-app      # shell compiles
npm run build                       # TypeScript strict check and bundle
```
Run all three before opening a pull request. Core tests use temporary directories, so they never touch your files.

## Working on the UI without the desktop shell
`npm run dev` opens the UI in a browser, but there is no Tauri backend, so every `invoke` fails. To explore states, mock `window.__TAURI_INTERNALS__.invoke` (and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener`) with Playwright's `addInitScript`, answering `get_settings`, `start_scan` (then emit `scan-item`, `scan-progress`, `scan-done` through the registered event handlers) and so on. This is how the UI states were checked.

## Building releases

### Build the installer for your OS
```bash
npm install
npm run tauri build
```
This type-checks and bundles the UI, compiles Rust in release mode, and packages installers. The first build takes several minutes. Tauri cannot cross-compile bundles, so build each OS on that OS (or in CI with one runner per OS).

Outputs (the Cargo workspace puts `target/` at the repository root):

| OS | Location | Files |
| --- | --- | --- |
| Windows | `target/release/bundle/msi/` and `target/release/bundle/nsis/` | `.msi` and `-setup.exe` installers |
| macOS | `target/release/bundle/dmg/` and `target/release/bundle/macos/` | `.dmg` and `Dev Cleaner.app` |
| Linux | `target/release/bundle/deb/`, `rpm/`, `appimage/` | `.deb`, `.rpm`, `.AppImage` |

The bare executable is also at `target/release/dev-cleaner-app` (`.exe` on Windows). It runs without installing, but needs WebView2 (Windows) or WebKitGTK (Linux) on the machine.

Build only one format, for example `npm run tauri build -- --bundles nsis` (Windows), `-- --bundles dmg` (macOS) or `-- --bundles appimage` (Linux). Build without bundling: `npm run tauri build -- --no-bundle`.

Debug build with the dev tools open, closer to production than `tauri dev`: `npm run tauri build -- --debug`.

### Versioning
Bump `version` in all three places together: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (and `core/Cargo.toml`). Then tag the commit, for example `git tag v0.2.0 && git push --tags`.

### Signing
Releases are unsigned for now, so each OS warns the first time the app opens. The README and the release notes tell users how to open it anyway.
- **Windows:** SmartScreen warns on unsigned `.exe`/`.msi`. To remove the warning, sign with a code-signing certificate; see the Tauri "Windows Code Signing" guide.
- **macOS:** Gatekeeper blocks unsigned apps downloaded from the internet until the user allows them. To remove that, you need an Apple Developer ID certificate and notarization; see Tauri "macOS Code Signing".
- **Linux:** no signing is required.

### Publishing a release (GitHub Actions)
`.github/workflows/release.yml` builds every OS when you push a version tag:

1. Bump the version (see Versioning above) and merge to `main`.
2. Tag that commit with the same version: `git tag v1.0.0 && git push origin v1.0.0`. The workflow stops if the tag and `src-tauri/tauri.conf.json` disagree.
3. The workflow creates a **draft** release with the notes from `.github/release-notes.md` (`{{VERSION}}` is filled in), then builds on Windows, macOS and Linux and attaches:

| File | From |
| --- | --- |
| `dev-cleaner-<v>-windows-x64-portable.exe` | `target/release/dev-cleaner-app.exe`, the standalone app (no installer) |
| `dev-cleaner-<v>-windows-x64-setup.exe` | NSIS installer |
| `dev-cleaner-<v>-windows-x64.msi` | MSI installer |
| `dev-cleaner-<v>-macos-universal.dmg` | Universal (Apple Silicon and Intel) disk image |
| `dev-cleaner-<v>-linux-x86_64.AppImage`, `-linux-amd64.deb`, `-linux-x86_64.rpm` | Linux bundles |

4. Open the draft on the Releases page, check it, and press **Publish**.

To rebuild an existing tag (for example after a runner failure), run the workflow from the Actions tab with that tag. Files already on the release are replaced.

## The app icon

### Where it lives
| File | Used for |
| --- | --- |
| `app-icon.svg` | The source. Edit this one. |
| `src-tauri/icons/*.png`, `icon.ico`, `icon.icns` | Generated. Window, taskbar, installer and app bundle icons. |
| `public/icon.svg` | The logo in the sidebar (a copy of the source). |

### Change or regenerate the icon
1. Edit `app-icon.svg` (square, ideally 1024 x 1024, with the artwork inside the rounded square so corners stay transparent).
2. Generate every size and format:
   ```bash
   npx tauri icon app-icon.svg
   ```
   This writes PNGs, `icon.ico` (Windows) and `icon.icns` (macOS) into `src-tauri/icons/`. It also creates `android/` and `ios/` folders that this desktop app does not use:
   ```bash
   rm -rf src-tauri/icons/android src-tauri/icons/ios      # Windows PowerShell: Remove-Item -Recurse -Force src-tauri\icons\android, src-tauri\icons\ios
   ```
3. Copy it for the sidebar: `cp app-icon.svg public/icon.svg` (PowerShell: `Copy-Item app-icon.svg public\icon.svg`).
4. Make the app pick it up. The icon is compiled into the executable, so Cargo must rebuild it:
   ```bash
   cargo clean -p dev-cleaner-app
   npm run tauri dev          # or: npm run tauri build
   ```
5. If the taskbar or Dock still shows the old icon, the OS is caching it:
   - **Windows:** unpin the app, close it, restart Explorer (Task Manager → Windows Explorer → Restart), run again. For a stubborn cache, delete `%LOCALAPPDATA%\IconCache.db` and sign out and in.
   - **macOS:** `killall Dock`, and for an installed app drag it out of and back into the Applications folder.
   - **Linux:** log out and in, or run `gtk-update-icon-cache`.

`npx tauri icon` needs a square image of at least 512 px. PNG works too: `npx tauri icon my-logo.png`.

## Everyday development workflow

### Branches and pull requests
```bash
git checkout -b feature/my-change
# edit, then run the checks (next section)
git add -A && git commit -m "Describe the change"
git push -u origin feature/my-change
```
Open a pull request against `main`. Keep it focused: one feature or fix, with tests for core changes and a screenshot for UI changes.

### Checks to run before every pull request
```bash
cargo fmt --all
cargo test -p dev_cleaner_core
cargo check -p dev-cleaner-app
npm run build
```

### Where things are stored while developing
`tauri dev` uses the real app data folder (see the [User guide](USER_GUIDE.md#where-your-data-is-stored)), so your dev runs share settings and history with an installed copy. Turn on **Dry run** while testing cleaning so real folders are not touched, or point **Scan folders** at a throwaway folder you create with fake `node_modules`.

### Making a safe sandbox to test cleaning
```bash
mkdir -p ~/sandbox/demo/node_modules && echo '{}' > ~/sandbox/demo/package.json
dd if=/dev/zero of=~/sandbox/demo/node_modules/big.bin bs=1M count=50
```
Add `~/sandbox` as a scan folder and clean it as often as you like.

### Debugging
- **Frontend:** in `tauri dev`, right-click the window and choose Inspect (or press F12 / Ctrl+Shift+I) for the browser dev tools.
- **Rust:** `println!`/`eprintln!` output appears in the terminal running `tauri dev`. Set `RUST_BACKTRACE=1` for stack traces.
- **Events:** `scan-item`, `scan-progress`, `scan-done`, `global-item`, `global-progress`, `global-done` are visible in the dev tools console if you add a temporary `listen` log.

### Common development problems
| Problem | Fix |
| --- | --- |
| `npm.ps1 cannot be loaded` (Windows PowerShell) | See the script policy fix in the [Windows guide](WINDOWS_SETUP.md), or use `cmd`. |
| `EBUSY` / watcher errors on Windows during `tauri dev` | Harmless: the file watcher touched a locked system file. |
| First `tauri dev` seems stuck | Rust is compiling. Wait for it; later runs are fast. |
| `linker 'link.exe' not found` | Install the C++ Build Tools (Windows guide). |
| Linux: `webkit2gtk-4.1` not found | Install the system libraries listed under [Prerequisites](#prerequisites). |
| Port 1420 already in use | Another dev server is running. Stop it, or change the port in `vite.config.ts` and `tauri.conf.json`. |
| UI changes do not show | Hard refresh in the dev tools, or restart `tauri dev`. |
| Rust changes do not show | `tauri dev` rebuilds on save; if not, stop and restart it. |
| Stale or strange build | `cargo clean`, delete `node_modules` and `dist`, run `npm install` again. |
| Old icon after changing it | See [The app icon](#the-app-icon), step 4 and 5. |
| Disk fills up from `target/` | `cargo clean` removes it (several GB). Dev Cleaner itself can clean other Rust projects. |

## Conventions
- UI text is plain language for non-experts: say "folder", "remove", "comes back with". Avoid jargon in labels.
- Every list shares the column grid in `components/Tree.tsx`. Reuse `TreeRow`, `GroupHeader`, `ScanPanel`, `EmptyState`, `Banner` instead of writing new markup.
- Tailwind v4 with dark mode through the `dark` class. Use the shared classes in `src/index.css` (`btn`, `input`, `card`, `muted`).
- Any new way to delete must go through `cleaner::check_target` and the "only scanned paths" rule.
- Rust: `cargo fmt` and no new warnings.
