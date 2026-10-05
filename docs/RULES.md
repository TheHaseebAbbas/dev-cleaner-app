# Rules and locations

[← Back to the README](../README.md) · [Settings reference](SETTINGS.md)

Two kinds of things are cleaned:

1. [Project rules](#project-rules): folders inside your projects (Projects tab).
2. [Tools & SDKs](#tools--sdks): folders in your user area (Tools & SDKs page).

Everything listed here can be recreated by the tool that made it, except where marked **not recoverable**. Parts marked ✂ can be removed one at a time.

## Project rules
A rule matches a folder name only when a marker file is present. Markers with `*` are patterns.

| Rule | Type | Folders | Must sit next to | Comes back with | ✂ |
| --- | --- | --- | --- | --- | --- |
| node_modules | Node.js | `node_modules` | `package.json` | `npm install` / `yarn` / `pnpm install` | |
| .next build | Node.js | `.next` | `package.json` | `next build` / `next dev` | |
| .nuxt / .output | Node.js | `.nuxt`, `.output` | `package.json` | `nuxt build` / `dev` | |
| JS tool caches | Node.js | `.turbo`, `.parcel-cache`, `.svelte-kit`, `.vite`, `.angular` | `package.json` | next build | |
| Flutter build | Flutter/Dart | `build` | `pubspec.yaml` | `flutter build` / `run` | ✂ |
| .dart_tool | Flutter/Dart | `.dart_tool` | `pubspec.yaml` | `flutter pub get` | |
| .fvm | Flutter/Dart | `.fvm` | `pubspec.yaml` | `fvm install` | |
| CocoaPods Pods | iOS/macOS | `Pods` | `Podfile` | `pod install` | |
| .gradle (project) | Android/Gradle | `.gradle` | `build.gradle(.kts)` or `settings.gradle(.kts)` | `gradle build` | |
| Gradle build output | Android/Gradle | `build` | same as above | `gradle build` | |
| Rust target | Rust | `target` | `Cargo.toml` | `cargo build` | ✂ |
| Maven target | Java | `target` | `pom.xml` | `mvn package` | |
| Python virtualenv | Python | `.venv`, `venv`, `env` | contains `pyvenv.cfg` | `python -m venv` + `pip install` | |
| Python caches | Python | `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox` | any project | next run | |
| bin / obj | .NET | `bin`, `obj` | `*.csproj`, `*.fsproj`, `*.vbproj` | `dotnet build` | |
| .vs | .NET | `.vs` | `*.sln` | reopen in Visual Studio | |
| SwiftPM .build | Swift | `.build` | `Package.swift` | `swift build` | |
| Elixir _build / deps | Elixir | `_build`, `deps` | `mix.exs` | `mix deps.get` | ✂ |
| Zig cache | Zig | `zig-cache`, `.zig-cache`, `zig-out` | `build.zig` | `zig build` | |
| Haskell build | Haskell | `.stack-work`, `dist-newstyle` | `stack.yaml`, `*.cabal`, `cabal.project` | `stack` / `cabal build` | |
| .terraform | Terraform | `.terraform` | `*.tf` | `terraform init` | ✂ |
| Unity Library | Unity | `Library`, `Temp`, `Obj` | `ProjectSettings` | reopen project (slow reimport) | ✂ |
| Go vendor | Go | `vendor` | `go.mod` | `go mod vendor` | |
| Composer vendor | PHP | `vendor` | `composer.json` | `composer install` | |
| Bundler | Ruby | `.bundle` | `Gemfile` | `bundle install` | |

**Risk levels.** Each rule is Low or Medium. Medium means rebuilding takes real effort or network access (installs, full compiles, reimport). The level is shown in the details panel and feeds the warnings.

**Protected from matching.** Nested matches are not listed twice: once a folder matches, the scanner does not look inside it. Folders under skipped names (Settings) are never entered.

## Tools & SDKs
Paths depend on your operating system. Use **Where it looks** in the app to see the exact path on your machine, and whether it exists.

### Node.js
npm cache, Yarn cache, pnpm store. All re-download on demand.

### Rust
| Item | Notes |
| --- | --- |
| Cargo registry ✂ | `index`, downloaded crates and unpacked sources are separate parts. |
| Rust toolchains ✂ | One part per toolchain. Your default is flagged red. `rustup install` brings one back. |

### Java and Android
| Item | Notes |
| --- | --- |
| Gradle caches ✂ | Parts are independent. The next build is slow. |
| Gradle distributions ✂ | One per Gradle version. The wrapper re-downloads the one a project needs. |
| Maven repository | `~/.m2/repository`. Offline builds fail until re-downloaded. |
| Android SDK platforms ✂, build-tools ✂, NDK ✂, CMake ✂, system images ✂, sources ✂ | Location from `ANDROID_HOME` / `ANDROID_SDK_ROOT`, else `%LOCALAPPDATA%\Android\Sdk` (Windows), `~/Library/Android/sdk` (macOS), `~/Android/Sdk` (Linux). Re-download in Android Studio's SDK Manager. |
| Android emulators (AVD) ✂ | `~/.android/avd`. **Red:** a deleted virtual device loses its apps and data. **Not recoverable.** |

### Flutter and Dart
Dart pub cache ✂ (`hosted` and `git` parts), FVM Flutter SDKs ✂ (one per version).

### Python, Go, .NET
pip cache, Conda package caches (miniconda and anaconda), Go build cache, NuGet packages ✂ (one per package), NuGet HTTP cache (Windows).

### IDEs
| Item | Notes |
| --- | --- |
| JetBrains IDE caches ✂ | One folder per IDE version. Settings are stored elsewhere and are kept. |
| Android Studio caches ✂ | Same. |
| VS Code caches ✂ | Only `Cache`, `CachedData`, `CachedExtensionVSIXs`, `CachedProfilesData`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `logs`, `Crashpad`. Everything else in the VS Code folder (settings, snippets, extensions, unsaved backups) is not offered. |

### Apple (macOS only)
| Item | Notes |
| --- | --- |
| Xcode DerivedData ✂ | One per project; rebuilt by Xcode. |
| Xcode Archives ✂ | **Red, not recoverable.** Your shipped builds and debug symbols. |
| iOS DeviceSupport ✂ | One per iOS version; recreated when a device connects. |
| CoreSimulator devices ✂ | **Red:** each simulator's apps and data are lost. |
| CocoaPods cache, Homebrew cache | Re-downloaded on demand. |

### System and other
| Item | Notes |
| --- | --- |
| Windows user Temp ✂ | Parts only; files in use are skipped and reported. |
| Claude Code old versions | **Red:** one of them is the version in use. |

### View only (never deleted)
| Item | Why |
| --- | --- |
| Docker Desktop disk (Windows, macOS), Docker rootless data (Linux) | Holds every image, container and volume. Shrink with `docker system prune -a`. |
| WSL distributions (Windows) | Each is a whole Linux system. Remove one with `wsl --unregister <name>` only if you are sure. |

## Adding your own
Project folders: [Custom rules](SETTINGS.md#custom-rules). New built-in rules and caches: [Developer guide](DEVELOPMENT.md#adding-a-rule-or-a-cache).
