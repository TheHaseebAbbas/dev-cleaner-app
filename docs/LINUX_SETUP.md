# Linux setup guide

Tested on Ubuntu 24.04. Any distro with WebKitGTK 4.1 works (Ubuntu/Debian 22.04+, Fedora, Arch, openSUSE). Allow about 10 GB of disk space and 20 to 30 minutes for the first setup.

## 1. Install system libraries

**Ubuntu / Debian / Mint**
```bash
sudo apt update
sudo apt install -y build-essential curl wget file git pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev librsvg2-dev libxdo-dev libssl-dev
```

**Fedora**
```bash
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libsoup3-devel \
  librsvg2-devel libxdo-devel openssl-devel curl wget file git gcc gcc-c++ make
```

**Arch / Manjaro**
```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libsoup3 librsvg xdotool \
  openssl base-devel curl wget file git
```

**openSUSE**
```bash
sudo zypper install -y webkit2gtk3-devel gtk3-devel libsoup-devel \
  librsvg-devel xdotool-devel libopenssl-devel gcc gcc-c++ make git curl
```

## 2. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version && cargo --version
```

## 3. Install Node.js (20 or newer)
Distro packages are often too old. Use nvm:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# open a new terminal, then:
nvm install --lts
node --version && npm --version
```

## 4. Get the code
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
The first run compiles all Rust dependencies, which takes 5 to 15 minutes. Later runs start in seconds. Leave the terminal open while using the app, and press Ctrl+C to stop it.

## 6. First use
1. Open **Settings**, and under **Scan folders** replace the default home folder with where your projects live (for example `~/projects`), using **Browse...**.
2. Optionally add **Protected paths** for projects you work on every day.
3. Turn on **Dry run** for the first cleanup so nothing is deleted.
4. Go to **Projects** and press **Scan**, select rows, then **Clean selected**.
5. When you are happy, turn Dry run off. Delete mode defaults to the desktop Trash (needs a desktop environment with a trash, such as GNOME, KDE or XFCE). On a bare window manager choose "Delete permanently" in Settings.

## 7. Build a package (optional)
```bash
npm run tauri build
```
Outputs are under `target/release/bundle/`: `deb/`, `rpm/` and `appimage/`. Install the one that matches your distro, for example `sudo apt install ./target/release/bundle/deb/*.deb`, or `chmod +x` and run the AppImage.

## Troubleshooting
| Problem | Fix |
| --- | --- |
| `The system library webkit2gtk-4.1 was not found` | Step 1 is incomplete. On Ubuntu 20.04 or older, upgrade; 4.1 is not available there. |
| `pkg-config` errors | Install `pkg-config` (or `pkgconf`) and the `-dev` packages from step 1. |
| Blank window or crash on NVIDIA or Wayland | Run `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`. |
| `node` too old / `npm install` fails | Use nvm (step 3) instead of the distro package. |
| Port 1420 already in use | Stop any other `npm run tauri dev`, or `fuser -k 1420/tcp`. |
| Trash fails on a minimal desktop | Set Delete mode to "Delete permanently" in Settings. |
| Reveal in file manager does nothing | Install `xdg-utils` so `xdg-open` exists. |
