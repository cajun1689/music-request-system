# Team Operations Playbook

## Weekly Residency Workflow (Gaslight)

### Use the same permanent link every week
- Residency event ID: `gaslight-residency`
- Guest link format: `/event/gaslight-residency`
- QR can remain permanent at venue

### Start-of-night checklist
1. Admin login
2. Load event by ID (`gaslight-residency`)
3. Click `Reset Weekly Queue (keep same link/QR)`
4. Confirm branding, Venmo handle, and live links
5. Open DJ dashboard for each DJ machine
6. Open Resolume overlay URL on visuals machine

### During show
- Approve/veto requests in dashboard
- Mark paid requests as verified when confirmed
- Mark tracks as played when finished
- Update multi-DJ "Now Playing" slots

### End-of-night
1. Optional: reset queue if you want clean state immediately
2. Keep same event ID and QR for next week
3. Do not rotate links unless needed

## Roles
- DJ team: moderation + playback state
- Visuals operator: overlay source in Resolume
- Admin lead: event settings, links, branding, queue reset

## Live Playlist Links
- Serato Live URL can be set/updated anytime in Admin
- Rekordbox playlist URL can be set/updated anytime in Admin
- Open buttons appear in Dashboard once configured

## Troubleshooting
- If custom domain breaks, test CloudFront URL directly first
- If request statuses lag, check WebSocket connectivity
- If overlay is blank, verify SpoutBrowser URL and alpha settings
