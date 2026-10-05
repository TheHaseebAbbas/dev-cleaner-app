<p align="center"><img src="app-icon.svg" width="112" alt="Dev Cleaner icon"></p>

# Dev Cleaner

A desktop app that finds and removes the junk developer tools leave behind: `node_modules`, build output, package caches, SDK downloads, simulators and IDE caches. It runs on Windows, macOS and Linux.

**Safe by default.** Nothing is deleted until you tick it and confirm. Every item is marked Recommended, Review or Keep with the reasons, folders Git tracks, system folders and folders holding keys cannot be selected, and each item is checked again right before it is removed. Removed folders go to the Trash and a dry-run mode lets you rehearse. See [Safety](docs/SAFETY.md).

## What you get

| Page | What it does |
| --- | --- |
| **Projects** | Scans your code folders and lists every rebuildable folder with size, a verdict and its reasons, risk, Git status and warnings. Quick select picks the safe ones for you. Folders made of independent pieces expand into sub-items you can remove one by one. |
| **Tools & SDKs** | Measures caches and SDKs in your user folder (npm, Cargo, Gradle, Android SDK, Xcode, JetBrains, VS Code caches and more), and shows which SDK and toolchain versions your projects still use. Docker and WSL disks are shown view-only. |
| **Trash** | Everything Dev Cleaner moved to the Trash, with **Restore** and **Delete forever**, and an auto-clear timer you can change. |
| **History** | Every cleanup, with the total space reclaimed. |
| **Settings** | An overview that opens into Appearance, Cleaning, Recommendations, Safety, Scanning, Protection, Rules, Trash and Diagnostics. Also has **About**. |

Both scanning pages show clear states: ready to scan, scanning with live progress, results, nothing found, stopped, and error.

## Quick start for users

1. Install the app, or run it from source (see the setup guide for your system below).
2. On first launch, choose the folder that holds your projects, for example `C:\development` or `~/code`. You can change it later in **Settings → Scanning**.
3. Go to **Projects** and press **Scan projects**.
4. Tick what you want gone, or use **Quick select → Safe**. Use the arrow on a row to pick only some parts.
5. Press **Reclaim** in the bar that appears, then confirm.

Press **Ctrl/Cmd+K** for the command palette. Shortcuts: Ctrl/Cmd+R scan, Ctrl/Cmd+A select visible, Ctrl/Cmd+, settings, Esc clear, Delete reclaim.

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
core/        Rust library: safety checks, rules, scanner, recommendations, cleanup planning, cleaner, global caches, settings, history (with tests)
src-tauri/   Tauri shell: commands and events that wrap the core
src/         React UI: views, components, hooks
docs/        Guides
app-icon.svg Source of the app icon (see the Developer guide to regenerate)
```

## License

Released under the [GNU General Public License v3.0](LICENSE). You may use and modify Dev Cleaner, and if you share a modified version you must share its source under the same license.
