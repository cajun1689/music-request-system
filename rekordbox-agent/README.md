# Rekordbox Bridge

A lightweight macOS menubar app that reads the currently playing track from Rekordbox's local database and pushes it to the Casper Requests cloud API for automatic request matching.

## How It Works

1. Rekordbox writes play history to a local SQLite (SQLCipher-encrypted) database.
2. This app polls that database every 10 seconds for the latest track.
3. When a new track is detected, it POSTs the title and artist to the cloud API.
4. The cloud API fuzzy-matches the track against approved song requests and marks matches as "played."

## Download & Install

1. Go to the [Releases page](https://github.com/cajun1689/music-request-system/releases) on GitHub.
2. Download the latest **Rekordbox Bridge** installer:
   - **`.pkg`** (Recommended) — double-click to install to `/Applications`
   - **`.dmg`** — drag to Applications
   - **`.zip`** — extract and move to Applications
3. Open **Rekordbox Bridge** from your Applications folder.
4. Click the vinyl icon (♫) in your menu bar to open the configuration window.

## Requirements

- macOS 11+ (Apple Silicon or Intel — universal binary)
- Rekordbox 6 or 7 installed and running in Performance mode
- An active event on Casper Requests with a Push Token (get from the Admin panel)

## Configuration

On first launch, click the menu bar icon and configure:

| Field | Description |
|-------|-------------|
| **API Base URL** | `https://casperrequests.com/prod` (pre-filled) |
| **Event ID** | The event ID from the Admin panel |
| **Push Token** | Copy from Admin panel > Rekordbox Bridge Token section |
| **SQLCipher Key** | Leave blank for most setups. Only needed if Rekordbox encrypts the DB. |
| **Polling Interval** | Default 10,000ms (10s). Lower = faster detection. |
| **Mode** | `Auto` reads from the DB. `Manual` lets you type tracks to push. |

## Features

- **Auto-detect Rekordbox database** — finds the DB path automatically
- **Launch at Login** — toggle in the app or from the menu bar
- **macOS notifications** — get notified when a track matches a request
- **Offline resilience** — failed pushes queue up and retry automatically
- **Manual fallback** — type tracks to push if DB polling fails
- **File logging** — logs stored in `~/Library/Logs/rekordbox-bridge/` for troubleshooting
- **Menu bar status** — see the current track and connection status from the tray

## macOS Permissions

- The app reads files under `~/Library/Pioneer/` and `~/Library/Application Support/Pioneer/`.
- On some macOS versions, you may need to grant **Full Disk Access** in System Settings > Privacy & Security.

## Troubleshooting

- **"Rekordbox database not found"**: Make sure Rekordbox is installed and has been opened at least once.
- **"Push failed (403)"**: Check that the Push Token matches the one in the Admin panel. Tokens can be rotated.
- **"DB read error: SQLITE_BUSY"**: The app retries automatically. If persistent, try increasing the polling interval.
- **No matches found**: The matching algorithm requires a confidence threshold. Ensure the request uses a similar title/artist to what Rekordbox shows.
- **Open Logs**: Click "Open Logs" at the bottom of the app window to view log files.

## Building from Source

```bash
cd rekordbox-agent
npm install
npm run dev          # run in dev mode
npm run package      # build .pkg, .dmg, and .zip to out/
```

## Code Signing & Notarization

To produce a signed + notarized build, set these environment variables before running `npm run package`:

```bash
export CSC_LINK="base64-encoded-.p12-certificate"
export CSC_KEY_PASSWORD="certificate-password"
export APPLE_ID="your@apple-id.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
```

In GitHub Actions, these are configured as repository secrets.

## Architecture

```
Rekordbox App
    |
    v
SQLCipher DB (djmdSongHistory table)
    |
    v  (poll every 10s)
Rekordbox Bridge (menubar app)
    |
    v  (POST /events/{eventId}/push-track)
Cloud API (AWS Lambda)
    |
    v
DynamoDB (mark request as "played")
```
