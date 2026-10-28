# Persuna Desktop

Persuna, your PERSUNA assistant, over your whole screen. It lives in a see-through layer above your apps, even full-screen ones: just Persuna and its words, no chat window. **Call it from anywhere with ⌘⇧Space** (Ctrl+Shift+Space on Windows; if another app has taken that, Alt+Shift+Space), from _Talk to Persuna_ in its menu bar menu, or by tapping it. It chimes, listens, answers out loud, and goes quiet after 45 seconds of silence. Press the shortcut or tap it while it talks to stop it. Right-click it for the rest: type instead, watch my screen, mute, conversation and notes, hide. Clicks pass straight through to your apps everywhere else.

The first time, a small welcome window lets you create an account or sign in; then Persuna appears and gets to know you out loud. It sits in the menu bar (Mac) or system tray (Windows), not the Dock or taskbar.

**Download:** [the latest release](https://github.com/utibe-ettebong/Persuna/releases/latest).

| Computer                              | File                              |
| ------------------------------------- | --------------------------------- |
| Mac with Apple silicon (M1 and later) | `Persuna-<version>-mac-arm64.dmg` |
| Mac with Intel                        | `Persuna-<version>-mac-x64.dmg`   |
| Windows PC                            | `Persuna-<version>-win-x64.exe`   |
| Windows on Arm                        | `Persuna-<version>-win-arm64.exe` |

## Permissions

- **Watching your screen.** On a Mac, the first time you turn watching on, macOS asks for **Screen Recording** permission. Persuna then shows three steps: open System Settings, turn on Persuna under Screen & System Audio Recording, and restart Persuna (macOS needs that before Persuna can see; it offers the restart in the dialog, in a notification and at the top of its menu bar menu). Until Persuna is signed with an Apple Developer ID, macOS treats each new version as a new app, so after an update Persuna clears the old entry once and macOS asks again. If Persuna is already switched on but still can't see, turn it off and on again, then restart Persuna. Persuna steps behind macOS's prompts and System Settings while you do this, so they're always clickable. After that, Persuna asks once what to watch (your whole screen or one app) and can remember it, so turning watching on just starts. Persuna only watches while watching is on, never keeps screenshots, and never sees itself. Change the remembered choice from the menu bar icon.
- **Microphone.** Asked the first time you talk to Persuna.

## How it works

It's a thin [Electron](https://www.electronjs.org) app around your PERSUNA server's `/companion?overlay=1` page. Sign in once; chat, voice, reminders, tasks and notes work as on the web. `main.js` holds the overlay window, click-through, tray menu and screen-watch permissions; `preload.js` is the only bridge to the page.

Run from source:

```bash
cd desktop
npm install
PERSUNA_URL=https://persuna-production.up.railway.app npm start
```

## Building and releasing

`.github/workflows/desktop.yml` builds on GitHub's Mac and Windows machines. Pull requests that touch `desktop/` check the builds. To publish:

1. Bump `version` in `desktop/package.json`.
2. Push a matching tag, for example `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`.

The workflow attaches the `.dmg`, `.zip` and `.exe` files to a GitHub Release.

Locally: `npm run dist:mac` (both Mac chips) or `npm run dist:win`.

## Signing (the platform standard)

Without certificates the builds are unsigned (Mac builds are signed ad hoc so they run on Apple silicon, and without the hardened runtime, which only works with a Developer ID). People then see a warning the first time:

- **Mac:** macOS says it can't check Persuna. Click Done, open System Settings → Privacy & Security, scroll down and click **Open Anyway** next to Persuna, then confirm. (On macOS 15 and later, right-click → Open no longer does this.)
- **Windows:** SmartScreen warns. Choose More info, then Run anyway.

To remove those warnings, add these repository secrets (Settings → Secrets and variables → Actions); the workflow signs and notarizes by itself:

| Platform         | Secrets                                                    | Where from                                                                                                                                             |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mac signing      | `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`                 | A "Developer ID Application" certificate from an [Apple Developer](https://developer.apple.com/programs/) account, exported as .p12 and base64-encoded |
| Mac notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Your Apple ID, an app-specific password from appleid.apple.com, and your team ID                                                                       |
| Windows          | `WIN_CERT_PFX_BASE64`, `WIN_CERT_PASSWORD`                 | An OV or EV code-signing certificate, exported as .pfx and base64-encoded                                                                              |

Not included yet: automatic updates (they need signed builds) and Linux.
