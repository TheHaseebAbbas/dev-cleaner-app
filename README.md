<p align="center"><img src="app-icon.svg" width="112" alt="Dev Cleaner icon"></p>

# Dev Cleaner

A desktop app that finds and removes the junk developer tools leave behind: `node_modules`, build output, package caches, SDK downloads, simulators and IDE caches. It runs on Windows, macOS and Linux.

It is the interactive version of [jemishavasoya/dev-cleaner](https://github.com/jemishavasoya/dev-cleaner), built with Tauri 2 (Rust) and React.

**Safe by default.** Nothing is deleted until you tick it and confirm. Removed folders go to the Trash, a dry-run mode lets you rehearse, and the app warns you before you touch anything a project may still need. See [Safety](docs/SAFETY.md).

## What you get

| Tab | What it does |
| --- | --- |
| **Projects** | Scans your code folders and lists every rebuildable folder with size, file count, age, git status and warnings. Folders made of independent pieces expand into sub-items you can remove one by one. |
| **Tool caches** | Measures caches and SDKs in your user folder (npm, Cargo, Gradle, Android SDK, Xcode, JetBrains, VS Code caches and more). Docker and WSL disks are shown view-only. |
| **History** | Every cleanup, with the total space reclaimed. |
| **Settings** | Scan folders, protected paths, rules, delete mode, dry run, depth, filters and theme. |

Both scanning tabs show clear states: ready to scan, scanning with live progress, results, nothing found, stopped, and error.

## Quick start for users

1. Install the app, or run it from source (see the setup guide for your system below).
2. Open **Settings** and add the folder that holds your projects, for example `C:\development` or `~/code`.
3. Go to **Projects** and press **Scan now**.
4. Tick what you want gone. Use the arrow on a row to pick only some parts.
5. Press **Clean selected** and confirm.

Tip: turn on **Dry run** in Settings for your first try. It reports what would be freed without touching anything.

Full walkthrough: [User guide](docs/USER_GUIDE.md).

## Documentation

| Guide | For | Contents |
| --- | --- | --- |
| [User guide](docs/USER_GUIDE.md) | Everyone | Screens, states, scanning, cleaning, sub-items, warnings, history |
| [Settings reference](docs/SETTINGS.md) | Everyone | Every setting, plus recommended setups per tech stack and per operating system |
| [Rules and locations](docs/RULES.md) | Everyone | Every project rule and tool cache, what it removes and how it comes back |
| [Safety, FAQ and troubleshooting](docs/SAFETY.md) | Everyone | How deletion is protected, what warnings mean, common problems |
| [Developer guide](docs/DEVELOPMENT.md) | Contributors | Setup, run, architecture, adding rules, tests, releases, icon |
| [Windows setup](docs/WINDOWS_SETUP.md) | Running from source | Step by step, including the PowerShell script policy fix |
| [macOS setup](docs/MACOS_SETUP.md) | Running from source | Step by step |
| [Linux setup](docs/LINUX_SETUP.md) | Running from source | Step by step per distribution |

## Quick start for developers

```bash
npm install
npm run tauri dev          # desktop app with hot reload
npm run dev                # UI only in a browser (no backend)
cargo test -p dev_cleaner_core
npm run tauri build        # installers
```

You need Rust, Node.js 20+ and the Tauri system prerequisites. The OS guides above list them.

More in the [Developer guide](docs/DEVELOPMENT.md): [building installers](docs/DEVELOPMENT.md#building-releases) per OS, [signing and CI](docs/DEVELOPMENT.md#signing-needed-for-public-releases), [changing the app icon](docs/DEVELOPMENT.md#the-app-icon) (and making it show up), the [everyday workflow](docs/DEVELOPMENT.md#everyday-development-workflow) and [common development problems](docs/DEVELOPMENT.md#common-development-problems).

## Project layout

```
core/        Rust library: rules, scanner, cleaner, global caches, settings, history (with tests)
src-tauri/   Tauri shell: commands and events that wrap the core
src/         React UI: views, components, hooks
docs/        Guides
app-icon.svg Source of the app icon (see the Developer guide to regenerate)
```
