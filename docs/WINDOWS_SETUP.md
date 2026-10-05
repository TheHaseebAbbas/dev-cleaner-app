# Windows setup guide

Tested target: Windows 10 (1809+) and Windows 11, 64-bit. Allow about 10 GB of disk space and 20 to 30 minutes for the first setup.

## 1. Install Microsoft C++ Build Tools
Rust on Windows needs the MSVC linker.
1. Download "Build Tools for Visual Studio" from https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Run the installer and tick **Desktop development with C++**. Keep the default components (MSVC, Windows 10/11 SDK).
3. Click Install and wait for it to finish (a restart may be requested).

## 2. Check WebView2
Tauri draws the UI with Microsoft Edge WebView2. It is preinstalled on Windows 11 and on up-to-date Windows 10. If the app later opens a blank window, install the "Evergreen Bootstrapper" from https://developer.microsoft.com/microsoft-edge/webview2/

## 3. Install Rust
1. Download and run `rustup-init.exe` from https://rustup.rs
2. Press Enter to accept the default (MSVC toolchain).
3. Close and reopen your terminal, then check:
   ```powershell
   rustc --version
   cargo --version
   ```

## 4. Install Node.js
1. Download the LTS version (20 or newer) from https://nodejs.org and run the installer with defaults.
2. Reopen the terminal and check:
   ```powershell
   node --version
   npm --version
   ```

## 5. Install Git
Download from https://git-scm.com/download/win (defaults are fine). Check with `git --version`.

## 6. Get the code
Open PowerShell (a normal window, not Administrator):
```powershell
git clone https://github.com/TheHaseebAbbas/dev-cleaner-app.git
cd dev-cleaner-app
git checkout claude/initial-app   # skip this once the PR is merged
npm install
```

## 7. Run the app
```powershell
npm run tauri dev
```
The first run compiles all Rust dependencies, which takes 5 to 15 minutes. Later runs start in seconds. The Dev Cleaner window opens by itself; leave the terminal open while you use it, and press Ctrl+C there to stop.

## 8. First use
1. Open **Settings**, and under **Scan folders** remove the default home folder and add the folders where your projects live (for example `C:\Users\you\projects`), using **Browse...**.
2. Optionally add **Protected paths** for projects you work on every day.
3. Turn on **Dry run** for the first cleanup so nothing is deleted.
4. Go to **Projects** and press **Scan**. Click a row for details, tick the rows you want, and press **Clean selected**.
5. When you are happy with the results, turn Dry run off. Delete mode defaults to the Recycle Bin, so you can restore anything.

## 9. Build an installer (optional)
```powershell
npm run tauri build
```
Outputs are under `target\release\bundle\`: an `.msi` (in `msi\`) and a setup `.exe` (in `nsis\`). Run either to install Dev Cleaner like a normal app. Windows SmartScreen may warn because the installer is not code-signed; choose More info, then Run anyway.

## What lives in AppData
Besides your project folders, the **Global caches** tab checks fixed Windows locations: the Android SDK (`%LOCALAPPDATA%\Android\Sdk`, or whatever `ANDROID_HOME` / `ANDROID_SDK_ROOT` points to), npm, Yarn, pnpm, pip and NuGet caches, Dart pub cache, JetBrains and Android Studio caches, and your user Temp folder. Every SDK component (platforms, build-tools, NDK, emulator images...) is listed per version so you can remove just the versions you do not use. Click **Where it looks** on the Projects or Global caches tab to see the exact paths on your machine.

## Troubleshooting
| Problem | Fix |
| --- | --- |
| `npm.ps1 cannot be loaded because running scripts is disabled on this system` | PowerShell blocks scripts by default. Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, answer Y, and reopen the terminal. No Administrator needed. Alternative: use Command Prompt (cmd) or write `npm.cmd` instead of `npm`. |
| `link.exe not found` or "linker `link.exe` failed" | Step 1 is missing or incomplete. Reinstall Build Tools with the C++ workload, then reopen the terminal. |
| `cargo` or `node` is not recognized | Close and reopen the terminal so PATH refreshes. |
| Blank white window | Install WebView2 (step 2). |
| `npm install` fails with EACCES or network errors | Run in a normal (non-admin) terminal on a normal drive, and check proxy or VPN settings. |
| Antivirus slows the first build | Exclude the project folder temporarily, or just wait. |
| Port 1420 already in use | Close any other running `npm run tauri dev`, or end the stray `node` process in Task Manager. |
| A folder shows an error when cleaning | A program still has files open (editor, dev server, `flutter`/`gradle` daemon). Close it and retry. |

## Known Windows limits in this first version
- The "Disk free" figure in the sidebar is blank on Windows for now (it uses a Unix tool).
- The Global caches tab lists only the caches common to all systems (npm, Cargo, Gradle, Maven, pub, NuGet, Android AVD and similar). Windows-only locations such as Visual Studio caches are planned.
