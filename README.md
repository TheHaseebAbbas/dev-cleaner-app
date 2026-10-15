<p align="center"><img src="app-icon.svg" width="112" alt="Dev Cleaner icon"></p>

# Dev Cleaner

A desktop app that finds and removes the junk developer tools leave behind: `node_modules`, build output, package caches, SDK downloads, simulators and IDE caches. It runs on Windows, macOS and Linux.

**Safe by default.** Nothing is deleted until you tick it and confirm. Every item is sorted into Safe to clean, Worth a look or Leaving alone with a plain reason, folders Git tracks, system folders and folders holding keys cannot be selected, and each item is checked again right before it is removed. Removed folders go to the Trash and a dry-run mode lets you rehearse. See [Safety](docs/SAFETY.md).

## What you get

| Page | What it does |
| --- | --- |
| **Clean** | The start page. One **Scan** checks your projects and your tools' caches together and sorts everything into **Safe to clean**, **Worth a look** and **Leaving alone**, each with one line saying why. Safe to clean is open and ticked; one button moves it to the Trash, and **Undo** puts it back. |
| **Projects** | Scans your code folders and lists every rebuildable folder with size, its group (Safe to clean, Worth a look, Leaving alone) and one line saying why. The safe ones are ticked for you after a scan. Folders made of independent pieces expand into sub-items you can remove one by one. |
| **Tools & SDKs** | Measures caches and SDKs in your user folder (npm, Cargo, Gradle, Android SDK, Xcode, JetBrains, VS Code caches and more), grouped by ecosystem. A **Dependency map** view shows which installed SDK and toolchain versions your projects use, and which they need but are missing. Docker and WSL disks are shown view-only. |
| **Activity** | Every cleanup, newest first, with **Restore** for whatever is still in the Trash. With advanced tools on, **Manage Trash** adds **Delete forever** and per-item **Keep longer**, and **Report** shows the full history with an **Over time** chart. |
| **Settings** | One page: **Folders** (project and protected folders), **Cleaning** (Trash or permanent, how long the Trash keeps items, scheduled cleanup) and **Appearance** (theme, **Show advanced tools**). With advanced tools on, the full Safety, Scanning, Rules (with a **Test** for custom rules), Trash and About sections are listed below. |

The sidebar shows **Clean**, **Activity** and **Settings**. **More** opens Projects, Tools & SDKs, the storage map, the dependency map and cleanup rules. **Show advanced tools** (in Settings, or **More**) keeps Projects and Tools & SDKs in the sidebar. It changes only what you see, never what can be removed.

Folders that a running program uses (a dev server, a Gradle daemon, an emulator, or a locked file on Windows) are marked **In use now** and need confirmation. Folders inside a pnpm, npm, Yarn, Cargo, Gradle, Go, Dart or Melos workspace are grouped under the workspace root.

Both scanning pages show clear states: ready to scan, scanning with live progress, results, nothing found, stopped, and error.

## Download

Get the latest version from the [Releases page](https://github.com/TheHaseebAbbas/dev-cleaner-app/releases/latest).

| System | File |
| --- | --- |
| Windows, no install | `dev-cleaner-<version>-windows-x64-portable.exe` (a single file you double-click) |
| Windows installer | `dev-cleaner-<version>-windows-x64-setup.exe` or `.msi` |
| macOS (Apple Silicon and Intel) | `dev-cleaner-<version>-macos-universal.dmg` |
| Linux | `.AppImage` (no install), `.deb` or `.rpm` |

### How to open it

The builds are not code-signed yet, so your system warns the first time you open them. This is expected.

- **Windows:** if SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. The portable `.exe` needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 already include.
- **macOS:** right-click Dev Cleaner in Applications and choose **Open**, then **Open** again. On macOS 15 or later, try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -cr "/Applications/Dev Cleaner.app"` in Terminal once.
- **Linux (AppImage):** run `chmod +x dev-cleaner-*.AppImage`, then double-click it or start it from a terminal. On Ubuntu 22.04 and later, install `libfuse2` first if it does not start.

## Quick start for users

1. [Download](#download) and open the app, or run it from source (see the setup guide for your system below).
2. On first launch, choose the folder that holds your projects, for example `C:\development` or `~/code`. You can change it later in **Settings → Scanning**.
3. On the **Clean** page, press **Scan**.
4. Keep the Safe to clean items that are already ticked, or open **Worth a look** and tick more. Use the arrow on a row to pick only some parts.
5. Press **Move to Trash** in the bar at the bottom, then confirm. **Undo** on the result line puts everything back.

Press **Ctrl/Cmd+K** for the command palette. Shortcuts: Ctrl/Cmd+R scan, Ctrl/Cmd+A select visible, Ctrl/Cmd+, settings, Esc clear, Delete cleans the selection.

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

More in the [Developer guide](docs/DEVELOPMENT.md): [building installers](docs/DEVELOPMENT.md#building-releases) per OS, [signing](docs/DEVELOPMENT.md#signing), [publishing a release](docs/DEVELOPMENT.md#publishing-a-release-github-actions), [changing the app icon](docs/DEVELOPMENT.md#the-app-icon) (and making it show up), the [everyday workflow](docs/DEVELOPMENT.md#everyday-development-workflow) and [common development problems](docs/DEVELOPMENT.md#common-development-problems).

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
