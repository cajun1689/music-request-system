## DJ Bridge v1.12.1

### Fixed

- Correctly decodes ShowKontrol TCNet artist and title metadata from CDJ-3000X players.
- Preserves the validated on-air confirmation behavior so requests are removed only after a track is actually playing through the DJM.

### New: ShowKontrol + CDJ-3000X

- Reads track title, artist, playback state, and DJM on-air status from ShowKontrol over TCNet.
- Supports CDJ-3000X players with a DJM-A9 on the same PRO DJ LINK network.
- A request is removed only after its deck is playing and continuously on-air for the configured confirmation period (10 seconds by default).
- Loaded, paused, cue-previewed, and silent-deck tracks are ignored.
- Two-deck crossfades confirm the incoming track without duplicating the outgoing track.
- Confirmed ShowKontrol matches are marked played immediately; Rekordbox and Serato retain their existing deferred safety behavior.

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
4. **DJ Software** — choose Auto-detect, Rekordbox, Serato DJ, or ShowKontrol / CDJ-3000X
5. **Source ID** — enter a name to identify your deck (e.g. `dj-slim`, `deck-a`)
6. **Mode** — set to **Auto** to start polling automatically
7. Click **Save Configuration**

#### 4. Verify It Works
- Open Rekordbox/Serato, or start ShowKontrol and play a track on a connected CDJ
- DJ Bridge should show the track under **Status** within 10 seconds
- The status badge turns green when connected

#### ShowKontrol / CDJ Setup
1. Connect both CDJ-3000X players, the DJM-A9, and the Mac to the same wired PRO DJ LINK network.
2. Start ShowKontrol and confirm it sees the players and mixer.
3. In DJ Bridge, choose **ShowKontrol / CDJ-3000X**.
4. Leave **TCNet Network Interface** on Automatic, or select the Ethernet adapter used by ShowKontrol.
5. Use a unique ShowKontrol Source ID such as `burberri-showkontrol`; do not reuse a live-playlist source ID.
6. Save, approve the macOS Local Network prompt, and verify the TCNet panel says **Connected** and **DJM on-air signal available**.

#### 5. Sync Your Library (Optional)
- Scroll down to the **Library Sync** card and click **Sync Library**
- This uploads your full track list so the request system knows which songs you have
- It includes play counts so the system can suggest the most-played version

---

### Features
- **Auto-detect** — automatically finds Rekordbox or Serato running on your Mac
- **ShowKontrol / TCNet** — reads live CDJ metadata and DJM on-air state without relying on Rekordbox history
- **Now Playing push** — sends the current track to the request system every 10 seconds
- **Request matching** — notifies you when a played track matches an audience request
- **Library sync** — upload your full library so requests can be validated against your collection
- **Auto-updates** — DJ Bridge checks for new versions and updates itself
- **Launch at Login** — toggle to start DJ Bridge when your Mac boots

### Troubleshooting
- **Buttons not responding?** — make sure you saved your config and the status badge isn't red
- **Events not loading?** — check that the API Base URL is correct and click Refresh
- **No track detected?** — make sure Rekordbox/Serato is open and a track is loaded on a deck
- **ShowKontrol searching?** — enable TCNet, check the selected Ethernet interface, allow Local Network access in macOS Settings, and quit AnyDesk if it is using UDP ports 60000/60001
- **Decks found but no auto-removal?** — confirm the DJM-A9 is visible in ShowKontrol and the Bridge TCNet panel says the on-air signal is available
- **Logs** — click "Open Logs" at the bottom of the app to see detailed debug info

### Requirements
- macOS 11+ (Apple Silicon or Intel)
- Rekordbox 6/7, Serato DJ, or ShowKontrol with supported PRO DJ LINK hardware
