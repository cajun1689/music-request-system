# Rekordbox Bridge

A lightweight macOS menubar app that reads the currently playing track from Rekordbox's local database and pushes it to the Casper Requests cloud API for automatic request matching.

## How It Works

1. Rekordbox writes play history to a local SQLite (SQLCipher-encrypted) database.
2. This app polls that database every 10 seconds for the latest track.
3. When a new track is detected, it POSTs the title and artist to the cloud API.
4. The cloud API fuzzy-matches the track against approved song requests and marks matches as "played."

## Download & Install

1. Go to the [Releases page](https://github.com/cajun1689/music-request-system/releases) on GitHub.
2. Download the latest **Rekordbox Bridge .pkg** file for macOS.
3. Double-click the `.pkg` to run the installer. It will install the app to `/Applications/Rekordbox Bridge.app`.
4. If macOS warns the app is from an unidentified developer, go to **System Settings > Privacy & Security** and click **Open Anyway**, or right-click the app and select **Open**.

## Requirements

- macOS 11+ (Apple Silicon or Intel -- universal binary)
- Rekordbox 6 or 7 installed and running in Performance mode
- An active event on Casper Requests with a Push Token (get from the Admin panel)

## Building from Source (developers only)

```bash
cd rekordbox-agent
npm install
npm run dev          # run in dev mode
npm run package      # build .pkg and .dmg to out/ folder
```

## Configuration

On first launch, click the tray icon and configure:

| Field | Description |
|-------|-------------|
| **API Base URL** | Your API Gateway base URL (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com/prod`) |
| **Event ID** | The event ID from the Admin panel (e.g. `gaslight-residency`) |
| **Push Token** | Copy from Admin panel > Rekordbox Bridge Token section |
| **SQLCipher Key** | Leave blank for unencrypted DBs. For Rekordbox 6/7, the community-known key may be needed. |
| **Polling Interval** | Default 10000ms (10s). Lower = faster detection, higher CPU usage. |
| **Mode** | `Auto` reads from the DB. `Manual` lets you type tracks to push. |

## macOS Permissions

- The app reads files under `~/Library/Pioneer/` and `~/Library/Application Support/Pioneer/`.
- On some macOS versions, you may need to grant **Full Disk Access** in System Settings > Privacy & Security.
- If the app is unsigned, right-click the .app and select "Open" to bypass Gatekeeper on first launch.

## Manual Fallback

If the database read fails (Rekordbox update changed the schema, encryption key changed, etc.), switch to **Manual** mode and type the song title + artist to push directly.

## Offline Resilience

If Wi-Fi drops during a set, failed pushes are queued (up to 50 tracks) and retried automatically when the connection returns.

## Troubleshooting

- **"Rekordbox database not found"**: Make sure Rekordbox is installed and has been opened at least once.
- **"Push failed (403)"**: Check that the Push Token matches the one in the Admin panel. Tokens can be rotated.
- **"DB read error: SQLITE_BUSY"**: The app retries automatically. If persistent, try increasing the polling interval.
- **No matches found**: The matching algorithm requires a confidence threshold. Ensure the request uses a similar title/artist to what Rekordbox shows.

## Architecture

```
Rekordbox App
    |
    v
SQLCipher DB (djmdSongHistory table)
    |
    v  (poll every 10s)
Rekordbox Bridge App
    |
    v  (POST /events/{eventId}/push-track)
Cloud API (AWS Lambda)
    |
    v
DynamoDB (mark request as "played")
```
