# DJ Bridge club lighting preview

This is the offline-tested lighting integration for Gaslight, grandMA3 2.4.2.2. **The booth installation and real-room tests are still pending.** Do not replace a working show with an unverified import.

The included two-page **DJ Bridge - Club Lighting Preview Guide.pdf** is a printable operator reference with clearly labeled simulated-interface screenshots. A locally signed Apple Silicon preview is for offline development; the signed/notarized universal distribution is still pending.

## Everyday use, after booth setup

1. Open DJ Bridge and enable **Music connectors**. This does not raise the lights.
2. **Find MA** discovers the compatible booth show. **Open MA Remote** opens its control screen. The optional address field is a fallback when broadcast discovery is unavailable.
3. Load or start the first song, then press **Start Club Night**. The opening look is white with slow phased dimmer pulses and the wide movement patterns running slowly. The calibrated IMRELAX forward limits remain in effect.
4. The next distinct song starts normal automatic colors and the five-minute movement/dimmer rotation. The white opening is not in that rotation. Native CDJ changes require two seconds of playback through the mapped open A9 channel; Serato follows confirmed played-history records and may report later. **End Opening / Next Song** is the manual fallback if a track transition is not reported.
5. Dedicated lighting operators can still use the MA and optional APC. Manual color pads pause track-color automation as before.
6. **Lighting Off** or **Quit DJ Bridge** stops this computer's connectors and releases ownership. Closing the window keeps the menu-bar app open. The MA keeps running its current show and holds its last tempo if no music source remains.

The saved brightness is Stage 70%, Dance 80%, Garage 65%, each stage PAR group 55%, Bar 60%, side strobes 50%, Grand Master 100%. During the white opening, movement size is 100% with slow Div16 speed. Normal rotation restores Stage/Dance/Garage sizes 75/80/70 and the saved dimmer depths.

The side-strobe beat layer runs relative to its 50% brightness master: approximately 25–50% overall output. This preserves the last captured brightness. It does not raise the strobe master to the earlier 100% setting.

## Booth setup — still requires a visit

- Export a fresh show backup on the XT. Confirm `Gaslight_Club_Live`, booth `CWXT-E9A9VF8LTU`, and that Plugin 930 and OSC row 2 are free.
- Copy `GaslightBridge.lua` into the grandMA3 import/export directory. Import/run `Install Gaslight Bridge.lua` through the supported plugin workflow. Review the installer first; it guards the show/station and refuses to overwrite occupied slots.
- The existing OSC input remains UDP 8000, prefix `gma3`, Receive Command enabled. Row 2 is feedback-only UDP 9150; native SendOSC output must be enabled. Verify the exact native properties on 2.4.2.2 before saving.
- Save the show locally on the XT and export a separate verified backup.
- Test app discovery and the correct show identity before pressing Start Club Night.
- On Seth's Mac, existing standalone helpers are detected. After the booth plugin works, **Use Bridge connectors** backs up their three plist files, disables their startup, and stops only those services. Other DJs normally do not have those helpers installed.
- Verify both native CDJs, Serato/DVS, A9 USB clock and native-CDJ tempo fallback. Player 1 maps to A9 channel 2; player 2 maps to channel 3. Do not change that cabling without updating the profile/state mapping.
- Test the opening when the first song is already playing and when starting before music; then mix into a second song. Confirm it changes to colored normal rotation and does not automatically return to white.
- Test manual overrides, an unplugged APC, and Off/Quit cleanup. Test a second DJ's computer taking over, including after the old owner's app crashes.
- Copy the tested show and printable instructions to Downloads. Only then publish a normal update for all DJs.

## Connection and resource behavior

Only the lease owner runs the DJ receivers, Serato reader and native helper. Other bridges wait without duplicate music senders. Discovery sends a fixed request on the local private network, not a broad address scan. The MA validates the club show, booth hostname and fixed command verbs. Each computer uses request nonces; ownership lasts 12 seconds and is renewed every four seconds. No continuous MA plugin loop runs while Bridge is closed.

The bundled receiver is universal Intel/Apple Silicon and uses system CoreMIDI/libpcap; Python is not required. UDP 50001 can conflict with AnyDesk. The receiver uses passive packet capture when direct listening is unavailable. Capture permission on a new Mac must be tested; the UI reports capture errors. No DJ transport or audio-routing commands are sent.

## Recovery

Quit Bridge before re-enabling any legacy helpers. Their original plists are backed up under the app's user-data folder in `lighting-legacy-backup`, with recovery commands in `RECOVERY.txt`. Never run the old and new senders together. Disabling Bridge does not silently re-enable old background services.

The preview is not a firmware update or a replacement fixture patch. It requires the existing club cue library and plugins 901, 902, 903, 905 and 920. Tempo sync is not guaranteed downbeat/phrase alignment; the MA's Downbeat Resync remains available.

## Offline verification

`npm test` builds the app and universal receiver, then runs 24 tests covering packet handling, real local UDP ownership/handoff, shutdown cleanup, first-song anchoring, and the actual MA Lua code in a simulated engine. `scripts/test-lighting-sqlite.js` runs separately under Electron with its rebuilt native database module; it checks read-only synthetic Serato history, loaded-track suppression, exact played-track identity and cleanup. The pull-request and release workflows run both checks. These do not verify native MA object properties, physical fixtures or another Mac's capture permissions.
