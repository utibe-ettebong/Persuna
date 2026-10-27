# Persona Desktop

Persona in a see-through, frameless window that floats on top of your other apps (drag it by Persona itself), so it can sit beside Figma, a video editor or a spreadsheet and, **only when you choose a window**, watch it to learn your steps.

It is a thin [Electron](https://www.electronjs.org) shell around your PERSUNA server's `/companion` page. Sign in once in the window; chat, voice, reminders, tasks and notes work as on the web.

```bash
cd desktop
npm install
PERSUNA_URL=https://persuna-production.up.railway.app npm start
```

`PERSUNA_URL` defaults to the hosted app. Use `http://localhost:3000` for a local server.

## Watching other apps

Open the companion, press **Watch my screen**, then **Choose a window**. On recent macOS you get the system picker; elsewhere a list of open windows. Persona's own window is never offered. The first time on macOS, allow screen recording for "Electron" (System Settings → Privacy & Security → Screen Recording), then restart the app.

Persona looks every 30 seconds, only when the window has changed, writes the steps into a note, and keeps no screenshots. Stop it from the companion at any time.

## What this is not (yet)

Not a signed, installable app: run it from source as above. Packaging (electron-builder, code signing, auto-update) is the next step for distribution.
