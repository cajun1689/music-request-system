# Resolume Overlay Setup (Windows Visuals PC)

## Goal
Render the approved song request queue as a transparent scrolling ticker at the bottom of the Resolume output.

## URL Pattern
- Overlay URL format: `https://<app-domain>/overlay/<eventId>`
- Residency example: `https://casperrequests.com/overlay/gaslight-residency`

## Setup Steps (Team Standard)
1. Install [SpoutBrowser](https://bntr.itch.io/spout-browser) on the Windows visuals machine.
2. Launch SpoutBrowser with:
   - URL: `https://casperrequests.com/overlay/gaslight-residency`
   - Flags:
     - `--transparent-painting-enabled`
     - `--off-screen-frame-rate=60`
3. In Resolume, add a **Spout source** and select the SpoutBrowser feed.
4. Put overlay layer at top of composition stack.
5. Keep blend/composite mode that preserves alpha.
6. Save this as a Resolume preset/composition for quick weekly load.

## Operational Notes
- Only **approved** requests appear in ticker.
- When DJs mark a song **played**, ticker updates automatically.
- Multi-DJ now-playing status is managed from dashboard and can be shown to guests.
- Keep visuals PC online for real-time WebSocket updates.

## Fallback Option
If SpoutBrowser fails, use OBS Browser Source with transparent background and send to Resolume over NDI.

## Quick Troubleshooting
- Overlay blank:
  - verify overlay URL and event ID
  - confirm internet connection
  - confirm Spout source selected in Resolume
- Overlay not updating:
  - reload overlay page
  - confirm DJs are marking status changes in dashboard
