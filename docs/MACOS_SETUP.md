# macOS setup guide

Supports macOS 10.15+ on Intel and Apple Silicon. Allow about 10 GB of disk space and 20 to 30 minutes for the first setup.

## 1. Install Xcode Command Line Tools
Open Terminal (Spotlight, then "Terminal") and run:
```bash
xcode-select --install
```
Click Install in the dialog and wait. If it says the tools are already installed, continue. You do not need the full Xcode app.

## 2. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
Press Enter for the default install, then load it into the current shell:
```bash
source "$HOME/.cargo/env"
rustc --version && cargo --version
```

## 3. Install Node.js
Either download the LTS installer (20 or newer) from https://nodejs.org, or with Homebrew:
```bash
brew install node
node --version && npm --version
```

## 4. Get the code
Git comes with the Command Line Tools.
```bash
git clone https://github.com/TheHaseebAbbas/dev-cleaner-app.git
cd dev-cleaner-app
git checkout claude/initial-app   # skip this once the PR is merged
npm install
```

## 5. Run the app
```bash
npm run tauri dev
```
The first run compiles all Rust dependencies, which takes 5 to 15 minutes. Later runs start in seconds. Leave the terminal open while you use the app, and press Ctrl+C to stop it.

## 6. First use
1. Open **Settings**, and under **Scan folders** replace the default home folder with where your projects live (for example `~/Developer`), using **Browse...**.
2. Optionally add **Protected paths** for projects you work on every day.
3. Turn on **Dry run** for the first cleanup so nothing is deleted.
4. Go to **Projects** and press **Scan projects**, select rows, then **Reclaim**.
5. When you are happy with the results, turn Dry run off. Delete mode defaults to the Trash, so you can restore anything.

If macOS asks whether Dev Cleaner can access Documents, Desktop or Downloads, choose Allow; otherwise those folders are skipped. For folders it still cannot read, give your terminal (or the built app) Full Disk Access under System Settings, then Privacy & Security.

## 7. Build an app (optional)
```bash
npm run tauri build
```
Outputs are under `target/release/bundle/`: `macos/Dev Cleaner.app` and a `.dmg` in `dmg/`. Drag the app to Applications. Because it is not signed or notarized, the first launch may be blocked: right-click the app, choose Open, then Open again (or allow it under System Settings, Privacy & Security).

## Troubleshooting
| Problem | Fix |
| --- | --- |
| `cargo` or `rustc` not found | Run `source "$HOME/.cargo/env"` or open a new Terminal window. |
| `xcrun: error: invalid active developer path` | Run `xcode-select --install` again. |
| `npm install` permission errors | Do not use `sudo`. Reinstall Node from nodejs.org or Homebrew. |
| Port 1420 already in use | Stop any other `npm run tauri dev`, or run `lsof -i :1420` and kill that process. |
| "Dev Cleaner is damaged" or cannot be opened | Run `xattr -cr "/Applications/Dev Cleaner.app"` for an unsigned local build. |
| Freed space not visible in Finder | macOS may hold deleted data in Time Machine local snapshots or the Trash. Empty the Trash and check `tmutil listlocalsnapshots /`. |
