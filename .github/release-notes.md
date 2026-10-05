## Dev Cleaner {{VERSION}}

{{CHANGES}}

### Downloads

| System | File | Notes |
| --- | --- | --- |
| Windows (no install) | `dev-cleaner-{{VERSION}}-windows-x64-portable.exe` | One file. Double-click to run; nothing is installed. |
| Windows installer | `dev-cleaner-{{VERSION}}-windows-x64-setup.exe` | Installs for your user, with a Start menu entry and uninstaller. |
| Windows installer (MSI) | `dev-cleaner-{{VERSION}}-windows-x64.msi` | For managed or per-machine installs. |
| macOS (Apple Silicon and Intel) | `dev-cleaner-{{VERSION}}-macos-universal.dmg` | Open it and drag Dev Cleaner to Applications. |
| Linux (any distribution) | `dev-cleaner-{{VERSION}}-linux-x86_64.AppImage` | One file, no install. |
| Debian, Ubuntu | `dev-cleaner-{{VERSION}}-linux-amd64.deb` | `sudo apt install ./dev-cleaner-{{VERSION}}-linux-amd64.deb` |
| Fedora, openSUSE | `dev-cleaner-{{VERSION}}-linux-x86_64.rpm` | `sudo dnf install ./dev-cleaner-{{VERSION}}-linux-x86_64.rpm` |

### How to open it

These builds are not code-signed yet, so your system warns the first time you open them. This is expected.

- **Windows:** if SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. The portable `.exe` needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 already include.
- **macOS:** right-click Dev Cleaner in Applications and choose **Open**, then **Open** again. On macOS 15 or later, try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -cr "/Applications/Dev Cleaner.app"` in Terminal once.
- **Linux (AppImage):** run `chmod +x dev-cleaner-{{VERSION}}-linux-x86_64.AppImage`, then double-click it or start it from a terminal. On Ubuntu 22.04 and later, install `libfuse2` first if it does not start.
