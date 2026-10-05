# Settings reference

[← Back to the README](../README.md) · [User guide](USER_GUIDE.md)

Settings save automatically a moment after you change them. Open the **Settings** tab to edit them.

## Contents
1. [Every setting](#every-setting)
2. [Recommended setups by tech stack](#recommended-setups-by-tech-stack)
3. [Recommended setups by situation](#recommended-setups-by-situation)
4. [Per operating system notes](#per-operating-system-notes)
5. [Custom rules](#custom-rules)
6. [Editing settings.json by hand](#editing-settingsjson-by-hand)

## Every setting

Sections appear in this order in the app.

### Appearance
| Setting | Default | Notes |
| --- | --- | --- |
| **Theme** (`theme`) | System | System follows your OS dark/light setting. |

### Cleaning
| Setting | Default | What it does | Best value |
| --- | --- | --- | --- |
| **When removing** (`delete_mode`) | Move to Trash | Trash keeps a copy you can restore. Permanent frees the space at once and cannot be undone. | Trash for everyday use. Permanent only when the Trash is on a small disk or you need the space immediately. |
| **Dry run** (`dry_run`) | Off | Runs the whole flow and reports what would be freed, but deletes nothing. A banner in the sidebar reminds you it is on. | On for your first run, after changing rules, or when demoing. Off afterwards. |
| **Ask before removing** (`confirm_before_delete`) | On | Shows a summary dialog before removing. Items with a red warning always ask, even if this is off. | Keep on. Turn off only if you clean often and trust your protected paths. |

### Trash
| Setting | Default | What it does | Best value |
| --- | --- | --- | --- |
| **Clear automatically after** (`trash_retention_days`) | 30 days | Items Dev Cleaner moved to the Trash are deleted for good after this many days. 0 means never. | 7 to 14 days on a small disk, 30 days as a safety net, 0 if you want to review everything yourself. Not available on macOS. |

See [the Trash tab](USER_GUIDE.md#where-removed-folders-go-and-getting-them-back) to restore or delete items now.

Note on Trash: on a drive with little free space, Trash does not free anything until you empty it. Folders such as `node_modules` hold huge numbers of files, so emptying can take a while.

### Scanning
| Setting | Default | What it does | Best value |
| --- | --- | --- | --- |
| **Scan folders** (`scan_roots`) | Your home folder | The only places the Projects tab looks. | The folder(s) where you keep code, such as `~/code` or `C:\development`. Narrower is faster and safer than your whole home. |
| **Skipped folder names** (`exclude_names`) | `.git`, `.Trash`, `Library`, `AppData`, `.cache` | Names never entered, wherever they appear. | Keep the defaults. Add `archive`, `backup` or other folders you never want scanned. If your projects live under one of the default names, remove it. |
| **Search depth** (`max_depth`) | 8 | How many folder levels below a scan folder to search. | 4 to 6 if your projects sit directly under the scan folder, 8 to 12 for monorepos or deep layouts. Higher is slower. |
| **Default minimum size** (`min_size_mb`) | 0 MB | Starting value of the size filter. | 50 to 100 MB hides noise on large machines. Keep 0 if you want to see everything. |
| **Default minimum idle time** (`min_age_days`) | 0 days | Starting value of the idle filter. Hides projects used more recently. | 30 days is a good "old projects only" view. 0 for a full list. |
| **Scan when the app opens** (`scan_on_launch`) | Off | Starts the project scan automatically at launch. | On if you use the app regularly and your scan folders are modest. Off for huge folders so the app opens instantly. |

### Protection
| Setting | Default | What it does | Best value |
| --- | --- | --- | --- |
| **Protected paths** (`protected_paths`) | none | Anything inside these is listed but cannot be selected (shown with a lock). | Add the projects you work on every day, client projects, and anything with vendored or hand-edited dependencies. |

### Cleanup rules
Each rule can be switched on or off. A switched-off rule is never matched. The built-in list is in [Rules and locations](RULES.md). Rules for the tools you do not use cost nothing, but turning them off keeps the list focused.

## Recommended setups by tech stack
Scan folder: the folder that holds your projects. Everything below is optional tuning.

### JavaScript / TypeScript (React, Next.js, Vue, Nuxt, Svelte, Angular, Node)
- **Rules to keep on:** `node_modules`, `.next build`, `.nuxt / .output`, `JS tool caches`.
- **Depth:** 6 to 8. Monorepos (`apps/*`, `packages/*`) need 8 to 10 because each package has its own `node_modules`.
- **Protect:** the repos you run `npm run dev` in daily. A running dev server locks files and the clean-up fails halfway.
- **Tool caches worth cleaning:** npm cache, Yarn cache, pnpm store.
- **Watch out:** the pnpm store is shared by every project. Cleaning it makes the next install re-download, so do it only when you need the space.
- Restore with `npm install`, `yarn`, or `pnpm install`.

### Flutter / Dart
- **Rules to keep on:** `Flutter build`, `.dart_tool`, and `.fvm` if you use FVM.
- **Use parts:** open the `build` row and remove only `android` or `ios` output when you need space on one platform.
- **Tool caches:** Dart pub cache (`flutter pub get` restores it), FVM Flutter SDKs (one per version part; keep the versions your projects pin), Gradle caches, Android SDK parts, and on macOS Xcode DerivedData and CocoaPods.
- **Android SDK:** keep the `platforms` and `build-tools` your `android/app/build.gradle` uses (`compileSdk`). Remove older ones.
- **Scan on Windows:** set the scan folder to something like `C:\development\flutter_projects`.
- Restore with `flutter pub get`, then `flutter build`.

### Android (Kotlin / Java / Gradle)
- **Rules:** `.gradle (project)` and `Gradle build output` (the `build` folder beside `build.gradle`, `build.gradle.kts` or `settings.gradle`). The big wins are in Tool caches: **Gradle caches** (per-part), **Gradle distributions** (one per version), **Android SDK** parts, **emulator system images**.
- **Keep:** the SDK platform and build-tools matching `compileSdk`, the NDK version pinned in `build.gradle`, and the Gradle version in `gradle-wrapper.properties`.
- **Danger:** deleting an emulator (AVD) deletes its apps and data permanently. The app asks for an extra confirmation.
- The Android SDK location comes from `ANDROID_HOME` or `ANDROID_SDK_ROOT`, otherwise the OS default (`%LOCALAPPDATA%\Android\Sdk` on Windows).

### Rust
- **Rules:** `Rust target`. Open it to remove only `debug` or `release`.
- **Tool caches:** Cargo registry (index, crates, sources are separate parts), Rust toolchains (never remove your default one).
- **Tip:** `target` is often the biggest folder on a Rust developer's disk. Protect the crates you build all day, and clean the old ones.
- Restore with `cargo build`.

### Python
- **Rules:** `Python virtualenv`, `Python caches`.
- **Before deleting a virtualenv:** make sure the project has `requirements.txt`, `pyproject.toml` or a `Pipfile`. If not, the app shows a red warning because you could not recreate the environment.
- **Tool caches:** pip cache, Conda package cache.
- Restore with `python -m venv .venv && pip install -r requirements.txt`.

### .NET / C#
- **Rules:** `bin / obj` (only beside a `.csproj`/`.sln`-style project file) and `.vs`.
- **Tool caches:** NuGet packages (one part per package) and NuGet HTTP cache on Windows.
- Restore with `dotnet restore`.

### Java / Maven
- **Rules:** `Maven target`. **Tool caches:** Maven repository (`~/.m2`). Offline builds fail until dependencies are downloaded again.

### iOS / macOS (Swift, Xcode, CocoaPods)
- **Rules:** `CocoaPods Pods`, `SwiftPM .build`.
- **Tool caches:** Xcode DerivedData (safe, rebuilt automatically), iOS DeviceSupport (re-copied when a device connects), CoreSimulator devices (each simulator is a part and its data is lost), CocoaPods cache, Homebrew cache.
- **Danger:** **Xcode Archives** are your shipped builds and their debug symbols. They cannot be recreated. Review each date.

### Unity
- **Rules:** `Unity Library` (Library, Temp, Obj, only beside `ProjectSettings`). Unity rebuilds it on open, which can take a long time for big projects, so clean old projects, not current ones.

### Go, PHP, Ruby, Elixir, Haskell, Zig, Terraform
- Enable only the rules for the languages you use. Vendor folders (`vendor` for Go and Composer) can be committed on purpose, so the app warns when they are tracked by git.
- **Terraform** `.terraform` holds provider downloads. Restore with `terraform init`.

### Docker and WSL
- Shown **view only**. Dev Cleaner never touches the disk image because it holds all images, containers and volumes.
- Shrink safely with `docker system prune -a` (add `--volumes` only if you do not need volume data), then compact the virtual disk. On Windows with WSL 2 run `wsl --shutdown` and use `Optimize-VHD` (Hyper-V module) or `diskpart` → `compact vdisk` on the `.vhdx` file.

### VS Code
- Only cache and log folders are offered (`Cache`, `CachedData`, `Code Cache`, `GPUCache`, `logs`, and similar). Settings, snippets, keybindings, extensions and unsaved-file backups are never listed. Close VS Code before cleaning.

## Recommended setups by situation

| Situation | Suggested settings |
| --- | --- |
| **First time trying it** | Dry run on, Move to Trash, ask before removing on, one scan folder. |
| **Laptop with a small SSD** | Scan on launch off. Minimum size 100 MB. Permanent delete only after you have done a trash-mode run and are happy. Start with the Tool caches tab, which often frees the most with the least risk. |
| **Big workstation with hundreds of projects** | Minimum idle 30 days, depth 6, protect your active repos, skip `archive`/`backup` folders. |
| **Monorepo** | Depth 10, minimum size 20 MB, protect the root. |
| **Shared or work computer** | Keep confirm on, Trash on, add company repos under Protected paths. |
| **Cleaning before a backup or disk image** | Permanent delete, minimum idle 0, run both tabs. Make sure nothing is running. |

## Per operating system notes

### Windows
- Defaults skip `AppData` when scanning projects (it is a tool area, not a project area). Tool locations such as `%LOCALAPPDATA%` are read by the Tool caches tab instead.
- Antivirus real-time scanning slows deletion of huge `node_modules`. Excluding your projects folder in Windows Security helps.
- "File in use" errors mean an editor, dev server or emulator holds the files. Close them and retry.
- Windows user Temp is offered by parts only. Files in use cannot be removed and are reported.

### macOS
- Defaults skip `Library` when scanning projects; Xcode and simulator data are read by the Tool caches tab.
- Grant Full Disk Access if macOS blocks reading a folder (System Settings → Privacy & Security).
- Trash on macOS is the real Trash, so use Finder to empty it.

### Linux
- Defaults skip `.cache` for project scans; tool caches under `~/.cache` are listed in the Tool caches tab.
- Trash follows the freedesktop standard (`~/.local/share/Trash`).

## Custom rules
Add your own in **Settings → Cleanup rules → Add your own rule**.

| Field | Meaning | Example |
| --- | --- | --- |
| Name | Shown in the list | Gatsby cache |
| Folder names | Comma separated names to match | `.cache, public` |
| Marker files | Optional; the folder only matches when one of these sits next to it | `gatsby-config.js` |

Always use a marker file when the folder name is generic (`dist`, `out`, `cache`). Without one, every folder with that name inside your scan folders matches. Custom rules are marked with a **custom** badge and can be deleted again.

## Editing settings.json by hand
The file is in the data folder listed in the [User guide](USER_GUIDE.md#where-your-data-is-stored). Close the app first. Fields: `scan_roots`, `exclude_names`, `protected_paths`, `rule_enabled`, `custom_rules`, `delete_mode` (`"trash"` or `"permanent"`), `dry_run`, `confirm_before_delete`, `min_size_mb`, `min_age_days`, `max_depth`, `theme` (`"system"`, `"light"`, `"dark"`), `scan_on_launch`, `trash_retention_days`. Missing fields use defaults, so you can delete the file to start over.
