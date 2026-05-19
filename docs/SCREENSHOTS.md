# Screenshots

Conventions for capturing screenshots for the README, docs, and release notes.

## Required shots

For the v0.1.0 README and Releases page, we need:

| Shot | Filename | What's in frame |
|------|----------|-----------------|
| Hero | `hero` | Empty editor + sidebar with a few sample notes. Conveys "this is the app." |
| Distill | `distill` | Mid-action: a slash command palette open over a note, `/distill` highlighted. |
| Branch | `branch` | The branches view for a single note, two alternative versions side by side. |
| Bridge | `bridge` | Bridge result: a synthesised paragraph that pulls from two source notes (sources visible). |
| Thread | `thread` | The thread view: ordered notes connected by a topic, with the AI's summary at top. |
| Settings | `settings` | Settings panel open, showing theme + notes path. |
| Command palette | `command-palette` | Cmd+K palette open over the editor. |

## Specs

- **Resolution**: logical 1280 × 800, retina @2x (so the saved PNG is 2560 × 1600).
- **Theme variants**: capture both dark and light. Filenames:
  - `feature-name-dark.png`
  - `feature-name-light.png`
- **Location**: `docs/images/`.
- **Format**: PNG. No JPEG.
- **Window decoration**: keep the Void window chrome (rounded corners, traffic-light buttons). No OS chrome around it.
- **Shadows off**: macOS adds a chunky shadow to window captures by default. Disable once per machine:
  ```bash
  defaults write com.apple.screencapture disable-shadow -bool TRUE
  killall SystemUIServer
  ```
  Re-enable with the same command and `-bool FALSE`.

## How to capture

1. Resize the Void window to 1280 × 800. The easiest way: open the developer console (Cmd+Opt+I when supported in dev mode), or use a window manager (`rectangle`, `raycast`).
2. Switch to the target view inside Void.
3. Switch theme: Settings → Appearance → Light / Dark.
4. **Cmd + Shift + 4**, then press **Space** — the cursor becomes a camera; click the Void window. The PNG lands on your Desktop.
5. Rename to the convention above and move to `docs/images/`.

## Tips

- Use the sample notes in `examples/notes/` (when present) so screenshots are stable across captures.
- Avoid timestamps, system clock, battery indicators in frame — crop them out before saving.
- For animations / GIFs, prefer short MP4s (under 5 s) recorded with **Cmd + Shift + 5** → "Record Selected Portion". Save as `docs/images/feature-name.mp4` and reference with HTML `<video>` in the README.
- Don't include personal data — use fake notes about topics like "Project Phoenix", "Quarterly review", "Reading list".

When in doubt, mirror the style of the latest hero screenshot already in the repo.
