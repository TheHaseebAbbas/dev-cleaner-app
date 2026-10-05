# Changelog

Each release's notes on GitHub include its section from this file. Add a `## <version>` section before tagging a release.

## 1.0.0

The first release of Dev Cleaner as a desktop app for Windows, macOS and Linux.

### Find what developer tools leave behind
- **Projects** scans your code folders for rebuildable folders such as `node_modules`, `target`, `build`, `.gradle`, `.dart_tool`, `.venv` and `Pods`. A folder only counts when the project's marker file is next to it, so a plain folder named `build` is left alone.
- **Tools & SDKs** measures caches and SDKs in your user folder, grouped by ecosystem: npm, Cargo, Gradle, the Android SDK, Flutter, Xcode, JetBrains, VS Code and more. Docker and WSL disks are shown but never deleted.
- **Dependency map** shows which installed SDK and toolchain versions your projects use, and which they need but are missing.
- Every item shows its size, file count, last activity, Git status and a details panel explaining what it is, why it was found, and how to get it back.

### Safe by default
- Every item gets a verdict, **Recommended**, **Review** or **Keep**, with the reasons behind it, and a risk level.
- Folders Git tracks, system folders and folders holding signing keys or credentials are blocked and can't be selected.
- Folders a running program is using (a dev server, a Gradle daemon, an emulator, a locked file on Windows) are marked **In use now** and need confirmation.
- Each item is checked again right before removal, and anything that changed since the scan is skipped.
- Removed folders go to the Trash. **Dry run** reports what would be freed without touching anything.

### Clean the way you want
- **Quick select** ticks the Safe, Recommended or Deep set for you.
- Split folders such as Rust's `target` can be cleaned part by part, so you can remove old `release` output and keep the `debug` build you are using.
- Folders inside pnpm, npm, Yarn, Cargo, Gradle, Go, Dart and Melos workspaces are grouped under the workspace root.
- **Trash** lists everything Dev Cleaner moved there, with Restore, Delete forever, an auto-clear timer and **Keep longer**.
- **History** logs every cleanup, with an **Over time** chart of space reclaimed per month.
- **Scheduled cleanup** (off by default) rescans on a schedule and never deletes permanently.

### Make it yours
- Settings for appearance (light and dark), cleaning, safety, scanning, protected paths, Trash, and custom cleanup rules with a **Test** button.
- Search with Ctrl/Cmd+K, a command palette with Ctrl/Cmd+Shift+P, and keyboard shortcuts for scanning, selecting and reclaiming.
