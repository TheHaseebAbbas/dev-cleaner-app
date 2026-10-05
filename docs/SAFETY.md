# Safety, FAQ and troubleshooting

[← Back to the README](../README.md)

## How deletion is protected
| Protection | What it means |
| --- | --- |
| **Trash first** | The default mode moves folders to the Trash so you can put them back from the Trash tab (Windows, Linux) or Finder (macOS). Items are cleared for good only after the number of days you choose. |
| **Dry run** | A switch that makes every clean-up a rehearsal. |
| **Only scanned paths** | The delete command accepts only paths the last scan produced (or parts of them). It cannot be asked to remove an arbitrary path. |
| **Rule-based matching** | Folders match only with their marker file beside them. |
| **Protected paths** | Listed but unselectable, with a lock. |
| **Hard refusals** | The app refuses your home folder, a drive root, and symbolic links. |
| **Whitelists** | VS Code offers cache folders only. Docker and WSL are view only. |
| **Warnings and extra confirmation** | See below. |
| **History** | Every removal is logged. |

## What the warnings mean
| Badge | Reason | What to do |
| --- | --- | --- |
| Check first: not in `.gitignore` | The folder is not ignored by git. It may hold files you created by hand. | Open the folder and confirm it only contains generated files. |
| Check first: project changed recently | The project was changed in the last few days. You may be working on it. | Close editors and dev servers, or leave it for later. |
| Check first: other projects may use it | SDK or Gradle versions are shared. | Keep versions your projects pin. |
| May be required: tracked by git | Files inside are committed. | Do not remove unless you want to delete committed files. Run `git status` first. |
| May be required: no requirements file | A Python environment with no `requirements.txt`, `pyproject.toml` or `Pipfile`. | Run `pip freeze > requirements.txt` first. |
| May be required: default toolchain / emulator / archive | Removing breaks your tools or loses data. | Read the note. Keep it unless you know why you are removing it. |

Red items need the **I understand** tick before the confirm button works. In dry run mode it is not required, because nothing is deleted.

## FAQ

**Is anything deleted automatically?** No. The app only scans until you select items and confirm.

**Will I lose my source code?** Rules target generated folders only. If a folder is tracked by git, the app tells you in red. Source files elsewhere in the project are never touched.

**Why does the first build take long after cleaning?** The tools rebuild or re-download what was removed. Use the restore command shown in the details panel.

**Why is the size smaller than Explorer or Finder shows?** The app reports size **on disk** (actual space freed). Apparent size is in the details panel.

**Why are some of my projects missing?** They are outside your scan folders, deeper than the search depth, under a skipped folder name, or no marker file sits beside the folder. Check **Where it looks**.

**How do I get a removed folder back?** Open the Trash tab and press Restore. See the [User guide](USER_GUIDE.md#where-removed-folders-go-and-getting-them-back). **Can I undo a permanent delete?** No. Use Trash mode unless you are sure.

**Does it send data anywhere?** No. Scanning and cleaning happen on your computer. The only network use is when you run the app from source and your package manager downloads dependencies.

## Troubleshooting
| Problem | Cause and fix |
| --- | --- |
| Scan finds nothing | No scan folder set, or the folders are missing. Open Settings → Scanning. Lower the minimum size. Raise the depth. |
| Scan is slow | Scan folder too wide (a whole drive). Narrow it, lower the depth, or add skipped names. |
| "File in use" or access denied when cleaning | A program holds the files. Close editors, dev servers, emulators, Docker, and retry. On Windows, also pause antivirus scanning for the folder. |
| Trash did not free space | Empty the Trash. Moving to Trash on the same drive does not free space until then. |
| Permission denied on macOS | Give the app Full Disk Access in System Settings → Privacy & Security. |
| Blank window on Windows | Install the WebView2 runtime (see the [Windows guide](WINDOWS_SETUP.md)). |
| `npm.ps1 cannot be loaded` in PowerShell | See the script policy fix in the [Windows guide](WINDOWS_SETUP.md). |
| `EBUSY` errors in the terminal while running `npm run tauri dev` on Windows | The file watcher touched a locked system file. Harmless. |
| Tools & SDKs page lists fewer items than expected | Only caches that exist on your machine are shown. Use **Where it looks**. |
| Settings did not save | Settings save after a short pause. Wait a second before closing. Check the data folder is writable. |
| Want to start over | Close the app and delete `settings.json` (see the [User guide](USER_GUIDE.md#where-your-data-is-stored)). |
