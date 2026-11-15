# DJ Bridge club lighting integration

This is the offline-tested lighting integration for Gaslight, grandMA3 2.4.2.2. Back up the venue show before installing or updating its native controller. Do not replace a working show with an unverified import.

Version 1.14.1 is distributed through the normal DJ Bridge updater. Lighting remains off by default. Updating the app does not install the booth plugin, change the working legacy helpers or start the venue lights.

The earlier Preview Guide PDF shows the previous first-song opening. Version 1.14.1 uses the 30-second opening described here; printed guides must be updated before distributing them.

## Everyday use, after booth setup

1. Open DJ Bridge and enable **Music connectors**. This does not raise the lights.
2. **Find MA** discovers the compatible booth show. **Open MA Remote** opens its control screen. The optional address field is a fallback when broadcast discovery is unavailable.
3. Load or start the first song, then press **Start Club Night**. The opening lasts 30 seconds and lights only the movers: white, slow phased dimmer pulses and wide slow movement. PARs, bar lights and side strobes remain off. The calibrated IMRELAX forward limits remain in effect.
4. After 30 seconds, the remaining light groups come up to their saved levels and normal automatic colors and five-minute movement/dimmer rotation begin. Song changes during the opening do not interrupt it. The white opening is not in that rotation. Native CDJ changes require two seconds of playback through the mapped open A9 channel; Serato follows confirmed played-history records and may report later. **End Opening Now** skips the remainder of the opening.
5. **Stop Show** brings all lights down and stops automation. **White Only** restores the saved group levels in steady white with movement and dimmer effects off. Both can be used while music connectors are off without starting the music receivers. They are also available directly on the booth CLUB HOME and AUTO CONTROLS screens after running `Install Show Controls.lua`.
6. Dedicated lighting operators can still use the MA and optional APC. Manual color pads pause track-color automation as before.
7. **Lighting Off** or **Quit DJ Bridge** stops this computer's connectors and releases ownership. Closing the window keeps the menu-bar app open. The MA keeps running its current show and holds its last tempo if no music source remains.

The saved brightness is Stage 70%, Dance 80%, Garage 65%, each stage PAR group 55%, Bar 60%, side strobes 50%, Grand Master 100%. During the white opening, movement size is 100% with slow Div16 speed. Normal rotation restores Stage/Dance/Garage sizes 75/80/70 and the saved dimmer depths.

The side-strobe beat layer runs relative to its 50% brightness master: approximately 25–50% overall output. This preserves the last captured brightness. It does not raise the strobe master to the earlier 100% setting.

## Booth setup

- Export a fresh show backup on the XT. Confirm `Gaslight_Club_Live`, booth `CWXT-E9A9VF8LTU`, and that Plugin 930 and OSC row 2 are free.
- Copy `GaslightBridge.lua` into the native folder returned by `GetPath('plugins')`. Import/run `Install Gaslight Bridge.lua` through the supported plugin workflow. Review the installer first; it guards the show/station and refuses to overwrite occupied slots.
- The existing OSC input remains UDP 8000, prefix `gma3`, Receive Command enabled. Row 2 is feedback-only UDP 9150; native SendOSC output must be enabled. Verify the exact native properties on 2.4.2.2 before saving.
- Save the show locally on the XT and export a separate verified backup.
- Test app discovery and the correct show identity before pressing Start Club Night.
- On Seth's Mac, existing standalone helpers are detected. After the booth plugin works, **Use Bridge connectors** backs up their three plist files, disables their startup, and stops only those services. Other DJs normally do not have those helpers installed.
- Verify both native CDJs, Serato/DVS, A9 USB clock and native-CDJ tempo fallback. Player 1 maps to A9 channel 2; player 2 maps to channel 3. Do not change that cabling without updating the profile/state mapping.
- Test the 30-second opening with and without music already playing. Confirm only movers light during it, a song change does not cut it short, and normal colors and full-room automation follow exactly once. Test Stop during the opening; it must cancel the pending transition.
- Test manual overrides, an unplugged APC, and Off/Quit cleanup. Test a second DJ's computer taking over, including after the old owner's app crashes.
- Copy the tested show and printable instructions to Downloads. Enable the new lighting connectors for normal club use only after these booth checks pass.

## Connection and resource behavior

Only the lease owner runs the DJ receivers, Serato reader and native helper. Other bridges wait without duplicate music senders. Discovery sends a fixed request on the local private network, not a broad address scan. The MA validates the club show, booth hostname and fixed command verbs. Each computer uses request nonces; ownership lasts 12 seconds and is renewed every four seconds. No continuous MA plugin loop runs while Bridge is closed.

The bundled receiver is universal Intel/Apple Silicon and uses system CoreMIDI/libpcap; Python is not required. UDP 50001 can conflict with AnyDesk. The receiver uses passive packet capture when direct listening is unavailable. Capture permission on a new Mac must be tested; the UI reports capture errors. No DJ transport or audio-routing commands are sent.

## Recovery

Quit Bridge before re-enabling any legacy helpers. Their original plists are backed up under the app's user-data folder in `lighting-legacy-backup`, with recovery commands in `RECOVERY.txt`. Never run the old and new senders together. Disabling Bridge does not silently re-enable old background services.

The preview is not a firmware update or a replacement fixture patch. It requires the existing club cue library and plugins 901, 902, 903, 905 and 920. Tempo sync is not guaranteed downbeat/phrase alignment; the MA's Downbeat Resync remains available.

## Offline verification

Run each architecture's execution checks on its native build host. Intel tests run on `macos-15-intel`; Apple Silicon tests run on `macos-latest`. Do not force the Intel app slice with Rosetta on a user's Mac: that can trigger macOS's future-compatibility warning even when the app and its components support Apple Silicon. The release workflow scans every bundled Mach-O file for an arm64 slice before publication. This verifies the Apple Silicon requirement; full macOS 28 behavior still requires testing when that OS is available.

`npm test` builds the app and universal receiver, then runs the regression suite covering packet handling, real local UDP ownership/handoff, shutdown cleanup, the 30-second opening and stop cancellation, the guarded installer, and the actual MA Lua code in a simulated engine. `scripts/test-lighting-sqlite.js` runs separately under Electron with its rebuilt native database module; it checks read-only synthetic Serato history, loaded-track suppression, exact played-track identity and cleanup. The pull-request and release workflows run both checks. These do not verify native MA object properties, physical fixtures or another Mac's capture permissions.

## macOS network access

Allow DJ Bridge to find devices on the local network when macOS asks. Version 1.14.1 assigns stable app-specific executable UUIDs before signing, avoiding the stock Electron identity collision described in Apple TN3179. If MA is reachable in a browser but Bridge reports an unreachable host, check System Settings → Privacy & Security → Local Network for DJ Bridge. Do not disable the Mac firewall or unrelated privacy protections.
