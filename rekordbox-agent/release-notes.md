## DJ Bridge

Download the installer for your Mac:

| File | Description |
|------|-------------|
| `.dmg` | **Recommended** — drag-to-Applications disk image |
| `.zip` | Portable zip archive (also used for auto-updates) |

---

### Setup Guide

#### 1. Install
- Download the `.dmg` file above
- Open it and drag **DJ Bridge** into your Applications folder
- If macOS shows a security warning, right-click the app and choose **Open**

#### 2. First Launch
1. Open **DJ Bridge** from Applications — a vinyl icon appears in your **menu bar**
2. Click the icon to open the settings window

#### 3. Configure
1. **API Base URL** — leave as default unless told otherwise
2. **Event** — click **Refresh**, then pick your event from the dropdown
3. **Push Token** — paste the token from the Admin panel (ask your event admin)
4. **DJ Software** — choose Auto-detect, Rekordbox, or Serato DJ
5. **Source ID** — enter a name to identify your deck (e.g. `dj-slim`, `deck-a`)
6. **Mode** — set to **Auto** to start polling automatically
7. Click **Save Configuration**

#### 4. Verify It Works
- Open Rekordbox or Serato and start playing a track
- DJ Bridge should show the track under **Status** within 10 seconds
- The status badge turns green when connected

#### 5. Sync Your Library (Optional)
- Scroll down to the **Library Sync** card and click **Sync Library**
- This uploads your full track list so the request system knows which songs you have
- It includes play counts so the system can suggest the most-played version

---

### Features
- **Auto-detect** — automatically finds Rekordbox or Serato running on your Mac
- **Now Playing push** — sends the current track to the request system every 10 seconds
- **Request matching** — notifies you when a played track matches an audience request
- **Library sync** — upload your full library so requests can be validated against your collection
- **Auto-updates** — DJ Bridge checks for new versions and updates itself
- **Launch at Login** — toggle to start DJ Bridge when your Mac boots

### Troubleshooting
- **Buttons not responding?** — make sure you saved your config and the status badge isn't red
- **Events not loading?** — check that the API Base URL is correct and click Refresh
- **No track detected?** — make sure Rekordbox/Serato is open and a track is loaded on a deck
- **Logs** — click "Open Logs" at the bottom of the app to see detailed debug info

### Requirements
- macOS 11+ (Apple Silicon or Intel)
- Rekordbox 6/7 or Serato DJ running
