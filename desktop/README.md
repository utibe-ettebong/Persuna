# Persuna Desktop

Persuna, your PERSUNA assistant, in a small bar at the top centre of your screen, above every app (even full-screen ones). Clicks pass straight through to your apps everywhere else.

- **Talk:** hold **right ⌥** (right Alt on Windows) from any app, say what you need, and let go. Persuna answers out loud.
- **Type:** tap right ⌥ twice quickly, or click the bar. The panel has a message box, your last exchange and quick actions (watch my screen, wrap up my day, to-dos).
- **Hands-free:** ⌃⌥P (Ctrl+Alt+P) starts a conversation that listens until you go quiet.
- **More:** right-click the bar. The menu bar menu changes the talk key (right ⌥, right ⌘, right ⌃ or off), the hands-free shortcut, open at login, and re-runs setup.

**First run.** A setup window walks you through:

1. Signing in, in your browser (quickest if you're already signed in there) or in the window.
2. Three Mac permissions, each with its reason: Microphone; Accessibility (to notice the talk key from any app, and only that key); Screen Recording (optional, for watching when you ask). If Persuna isn't in a System Settings list, drag its tile in.
3. A microphone test, with a picker.
4. Practising hold-to-talk.
5. Naming Persuna and choosing its look.
6. Four quick questions about your work, which Persuna remembers.
7. A first skill to learn, suggested from what takes you the most time.

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
