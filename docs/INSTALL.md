# Install Void on macOS

Void is a Tauri v2 desktop app. It ships only for macOS today (Apple Silicon and Intel, universal binary).

## 1. Download

Grab the latest `.dmg` from [Releases](https://github.com/intergalactisch/void/releases/latest). The filename looks like `Void_X.Y.Z_universal.dmg` (~50 MB).

## 2. Mount and copy

1. Double-click the downloaded DMG.
2. In the window that opens, drag **Void.app** to the **Applications** alias.
3. Eject the DMG (right-click the desktop icon → Eject).

## 3. First-launch Gatekeeper bypass

Void is **not** signed by an Apple Developer ID account, so macOS will refuse to open it on first launch. You only need to do this once per install.

Pick whichever method you prefer.

### Method A — Right-click → Open (works on most macOS versions)

1. Open `/Applications` in Finder.
2. **Right-click** (or Control-click) `Void.app` → choose **Open**.
3. In the dialog that says *"macOS cannot verify the developer of 'Void'"*, click **Open**.

> Note: macOS Sequoia (15+) often suppresses this prompt entirely and just refuses. If Method A does nothing, use Method B.

### Method B — System Settings → "Open Anyway"

1. Double-click `Void.app`. macOS will say *"Void is damaged and can't be opened."* Click **Cancel**.
2. Open **System Settings → Privacy & Security**.
3. Scroll to the bottom. You should see a line: *"Void was blocked because it is from an unidentified developer."*
4. Click **Open Anyway**.
5. Confirm in the resulting dialog.

### Method C — Terminal one-liner (fastest if you're comfortable)

```bash
xattr -d com.apple.quarantine /Applications/Void.app
```

Then double-click `Void.app` normally — it will launch without complaint.

## 4. Verify

Once Void launches, look for the menu-bar icon (top-right corner of your screen) — Void runs primarily from there. Open the main window with the menu-bar item → **Show Void**.

## 5. Automatic updates

Void checks for updates silently on launch via [tauri-plugin-updater](https://v2.tauri.app/plugin/updater/). When a new version is found, you'll see a toast in the bottom-right corner — click it to install and restart.

You can also trigger an explicit check from the menu-bar icon → **Check for Updates…**.

Updates are signed with our own Tauri key (not Apple's). The signature is verified before install, so a tampered update will be rejected.

## 6. Uninstall

1. Drag `Void.app` from `/Applications` to the Trash.
2. (Optional) Remove app data and settings:

   ```bash
   rm -rf ~/Library/Application\ Support/com.intergalactisch.void/
   rm -f ~/Library/Preferences/com.intergalactisch.void.plist
   rm -rf ~/Library/Caches/com.intergalactisch.void/
   ```

Your notes themselves live in the directory you configured under Settings → Notes Path (default `~/Documents/void/`). They are **not** removed by uninstalling Void — open them in any Markdown editor.

## Troubleshooting

- **"Void is damaged" with no Open Anyway button** — Sequoia sometimes hides the button until macOS has logged the refusal. Try double-clicking Void once first, then check Privacy & Security again.
- **Menu-bar icon doesn't appear** — Void requires Accessibility permission for the global capture shortcut. macOS will prompt the first time. If you denied it, re-enable under System Settings → Privacy & Security → Accessibility.
- **AI features don't work** — Void uses the `claude` and `codex` CLIs. Install at least one (`brew install` or follow the vendor docs) and confirm it's on your PATH. See Settings → AI.
- **Auto-update fails** — open Console.app, filter on `Void`, and include the lines in a bug report.

Still stuck? Open a [discussion](https://github.com/intergalactisch/void/discussions) or [bug report](https://github.com/intergalactisch/void/issues/new?template=bug_report.yml).
