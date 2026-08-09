# SafeTube UI screenshots

Physical PNG captures for UI design review.

## Folders

| Folder | What’s inside | How captured |
|--------|----------------|--------------|
| **`gallery/`** | Full set of screens & dialogs (PIN, remove channel, watch chrome, overlays, etc.) using real React components | Playwright phone viewport → Vite `/dev/ui-gallery` |
| **`web/`** | Live app routes (auth, kid, channels, gates…) | Playwright against running Vite app |
| **`android/`** | Installed debug APK on Android emulator | `adb screencap` after cold start |

## Primary design pack

Use **`ui-screenshots/gallery/`** — it includes dialogs that need auth/PIN in the real app, rendered with sample data.

Notable files:

- `parental-pin-modal.png` — 6-digit parent PIN
- `remove-channel-modal.png` — remove channel confirm
- `forgot-pin-modal.png` — forgot PIN
- `watch-chrome.png` — YouTube-style player + likes/views
- `channel-tabs-browse.png` — Home / Videos / Shorts / Live
- `daily-limit.png`, `screen-time-locked.png`, `gift-challenge.png`
- `lion-closet.png`, `lion-level-up.png`
- `auth.png`, `splash.png`, …

## Regenerate

```powershell
# Terminal 1
npm run dev

# Terminal 2 (emulator optional for --android)
node scripts/capture-ui-screenshots.mjs --all
```

DEV gallery route (not in production builds): `http://127.0.0.1:5173/dev/ui-gallery`

## Note on authenticated parent screens

Dashboard / settings / channel manager with a real Supabase session require parent login. Without credentials, those routes redirect to auth or the PIN gate (see `web/route-*-gate.png`). The gallery pack covers the same visual components for design.
