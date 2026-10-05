# Rules and locations

[← Back to the README](../README.md) · [Settings reference](SETTINGS.md)

Two kinds of things are cleaned:

1. [Project rules](#project-rules): folders inside your projects (Projects tab).
2. [Tools & SDKs](#tools--sdks): folders in your user area (Tools & SDKs page).

Everything listed here can be recreated by the tool that made it, except where marked **not recoverable**. Parts marked ✂ can be removed one at a time.

## Project rules
A rule matches a folder name only when a marker file is present. Markers with `*` are patterns, and `../` means the folder above. Rules are versioned (currently version 2) and each match records the rule version.

**Risk** is what you lose: *Safe* rebuilds by itself, *Caution* needs downloads or a long rebuild. **Rebuild** and **Download** are rough costs (None, Low, Medium, High).

| Rule | Type | Folders | Must sit next to | Comes back with | Risk | Rebuild / Download | ✂ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| node_modules | Node.js | `node_modules` | `package.json` | `npm ci`, `pnpm install`, `yarn install` or `bun install` (picked from the lock file) | Caution | Medium / Medium | |
| .next build | Node.js | `.next` | `package.json` | `next build` / `next dev` | Safe | Low / None | ✂ |
| .nuxt | Node.js | `.nuxt` | `package.json` | `nuxt dev` / `nuxt build` | Safe | Low / None | |
| .output (Nuxt) | Node.js | `.output` | `package.json` | `nuxt build` | Safe | Low / None | |
| JS tool caches | Node.js | `.turbo`, `.parcel-cache`, `.svelte-kit`, `.vite`, `.angular` | `package.json` | next build | Safe | Low / None | |
| Flutter build | Flutter/Dart | `build` | `pubspec.yaml` | `flutter build` / `run` | Safe | Low / None | ✂ |
| .dart_tool | Flutter/Dart | `.dart_tool` | `pubspec.yaml` | `flutter pub get` | Safe | Low / Low | |
| .fvm | Flutter/Dart | `.fvm` | `pubspec.yaml` | `fvm use` / `fvm install` | Caution | Low / Medium | |
| CocoaPods Pods | iOS/macOS | `Pods` | `Podfile` | `pod install` | Caution | Medium / Medium | |
| .gradle (project) | Android/Gradle | `.gradle` | `build.gradle(.kts)` or `settings.gradle(.kts)` | `gradle build` | Safe | Low / None | |
| Gradle build output | Android/Gradle | `build` | same as above | `gradle build` | Safe | Low / None | |
| Rust target | Rust | `target` | `Cargo.toml` | `cargo build` | Safe | Medium / None | ✂ |
| Maven target | Java | `target` | `pom.xml` | `mvn package` | Safe | Low / None | |
| Python virtualenv | Python | `.venv`, `venv`, `env` | contains `pyvenv.cfg` | `uv sync`, `poetry install`, `pipenv install` or `pip install -r requirements.txt` | Caution | Medium / Medium | |
| Python caches | Python | `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox` | any project | next run | Safe | None / None | |
| bin / obj | .NET | `bin`, `obj` | `*.csproj`, `*.fsproj`, `*.vbproj` | `dotnet build` | Safe | Low / None | |
| .vs | .NET | `.vs` | `*.sln` | reopen in Visual Studio | Safe | None / None | |
| SwiftPM .build | Swift | `.build` | `Package.swift` | `swift build` | Safe | Low / Low | |
| Elixir _build | Elixir | `_build` | `mix.exs` | `mix compile` | Safe | Low / None | ✂ |
| Elixir deps | Elixir | `deps` | `mix.exs` | `mix deps.get` | Caution | Medium / Medium | |
| Zig cache | Zig | `zig-cache`, `.zig-cache`, `zig-out` | `build.zig` | `zig build` | Safe | Low / None | |
| Haskell build | Haskell | `.stack-work`, `dist-newstyle` | `stack.yaml`, `*.cabal`, `cabal.project` | `stack` / `cabal build` | Caution | High / Low | |
| .terraform | Terraform | `.terraform` | `*.tf` | `terraform init` | Caution | Low / Medium | ✂ |
| Unity Library | Unity | `Library` | `ProjectSettings` | reopen project (slow reimport) | Caution | High / Low | ✂ |
| Unity Temp / Obj | Unity | `Temp`, `Obj`, `obj` | `ProjectSettings` | reopen project | Safe | None / None | |
| Go vendor | Go | `vendor` | `go.mod`, and contains `modules.txt` | `go mod vendor` | Caution | Low / Medium | |
| Composer vendor | PHP | `vendor` | `composer.json` | `composer install` | Caution | Medium / Medium | |
| Bundler vendor/bundle | Ruby | `vendor/bundle` | `../Gemfile`, and contains `ruby` | `bundle install` | Caution | Medium / Medium | |

The Ruby rule used to match `.bundle`. That folder holds Bundler's per-project configuration, not installed gems, so it is no longer offered.

### How sure a match is
Every match gets a **confidence** (Low to Very high) and a list of the evidence, shown under *Why it was detected*:
- The rule's marker file is present (required).
- A lock file or config beside the folder (for example `pnpm-lock.yaml` or `Cargo.lock`) raises confidence.
- Git ignoring the folder raises it. Git ignoring a folder does **not** prove its contents are disposable, so it is evidence, not a pass.
- An untracked folder in a repository lowers it.

Only matches at or above the *Minimum confidence* setting (default High) can be marked Recommended. Custom rules are capped at Medium.

### Projects and packages
The project a folder belongs to is the Git repository root inside your scan folder, or otherwise the topmost folder in an unbroken chain of folders that hold project files. So `app/android/build` belongs to `app`, not `android`. The folder holding the marker file is shown as the *package*.

### Nested matches
Once a folder matches, the scanner does not look inside it. Folders under skipped names (Settings) are never entered. Symlinks, junctions and mount points are never followed.

## Tools & SDKs
Paths depend on your operating system. Use **Where it looks** in the app to see the exact path on your machine, and whether it exists. The page groups locations as *Package & build caches*, *SDKs & toolchains*, *IDE caches*, *Developer state*, *Temporary data* and *View only*.

**Version usage.** After a project scan, SDK and toolchain versions are checked against what your projects ask for: `compileSdk`, `buildToolsVersion` and `ndkVersion` in Gradle files, `rust-toolchain(.toml)`, `.fvmrc` / `fvm_config.json`, and the Gradle wrapper's `distributionUrl`. Each version is marked *Used by N projects* (Keep), *Not used by scanned projects* or *Usage unknown*. A project that does not pin a version makes the answer unknown rather than unused.

### Node.js
npm cache, Yarn cache, pnpm store. All re-download on demand.

### Rust
| Item | Notes |
| --- | --- |
| Cargo registry ✂ | `index`, downloaded crates and unpacked sources are separate parts. |
| Rust toolchains ✂ | Parts only, one per toolchain. Checked against `rust-toolchain` files. Your default is flagged red. `rustup install` brings one back. |

### Java and Android
| Item | Notes |
| --- | --- |
| Gradle caches ✂ | Parts are independent. The next build is slow. |
| Gradle distributions ✂ | One per Gradle version. The wrapper re-downloads the one a project needs. |
| Maven repository | `~/.m2/repository`. Offline builds fail until re-downloaded. |
| Android SDK platforms ✂, build-tools ✂, NDK ✂, CMake ✂, system images ✂, sources ✂ | Location from `ANDROID_HOME` / `ANDROID_SDK_ROOT`, else `%LOCALAPPDATA%\Android\Sdk` (Windows), `~/Library/Android/sdk` (macOS), `~/Android/Sdk` (Linux). Risk Danger, lowered to Caution for versions no scanned project uses. Re-download in Android Studio's SDK Manager. |
| Android emulators (AVD) ✂ | `~/.android/avd`. Parts only, risk **Critical**: a deleted virtual device loses its apps and data. The matching `.ini` file is removed with it. **Not recoverable.** |

### Flutter and Dart
Dart pub cache ✂ (`hosted` and `git` parts), FVM Flutter SDKs ✂ (one per version).

### Python, Go, .NET
pip cache, Conda package caches (miniconda and anaconda), Go build cache, NuGet packages ✂ (one per package), NuGet HTTP cache (Windows).

### IDEs
| Item | Notes |
| --- | --- |
| JetBrains IDE caches ✂ | One folder per IDE version. Settings are stored elsewhere and are kept. On Windows the location is parts only and the Toolbox folder is never offered. |
| Android Studio caches ✂ | Only folders whose name starts with `AndroidStudio`. Other folders under `Google` (such as Chrome's profile on Windows) are never offered. |
| VS Code caches ✂ | Only `Cache`, `CachedData`, `CachedExtensionVSIXs`, `CachedProfilesData`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `logs`, `Crashpad`. Everything else in the VS Code folder (settings, snippets, extensions, unsaved backups) is not offered. |

### Apple (macOS only)
| Item | Notes |
| --- | --- |
| Xcode DerivedData ✂ | One per project; rebuilt by Xcode. |
| Xcode Archives ✂ | Parts only, risk **Critical, not recoverable.** Your shipped builds and debug symbols. |
| iOS DeviceSupport ✂ | One per iOS version; recreated when a device connects. |
| CoreSimulator devices ✂ | Parts only, risk **Critical**: each simulator's apps and data are lost. |
| CocoaPods cache, Homebrew cache | Re-downloaded on demand. |

### System and other
| Item | Notes |
| --- | --- |
| Windows user Temp ✂ | Parts only, files and folders. Anything changed in the last 7 days is blocked; files in use are skipped and reported. |
| Claude Code old versions ✂ | One part per version. The version in use (the target of `~/.local/bin/claude`, else the newest) is blocked. |

### View only (never deleted, risk Blocked)
| Item | Why |
| --- | --- |
| Docker Desktop disk (Windows, macOS), Docker rootless data (Linux) | Holds every image, container and volume. Shrink with `docker system prune -a`. |
| WSL distributions (Windows) | Each is a whole Linux system. Remove one with `wsl --unregister <name>` only if you are sure. |

## Adding your own
Project folders: [Custom rules](SETTINGS.md#custom-rules). New built-in rules and caches: [Developer guide](DEVELOPMENT.md#adding-a-rule-or-a-cache).
