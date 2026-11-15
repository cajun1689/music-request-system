DJ Bridge 1.14.2 fixes MA discovery on computers with VPN, container, or other virtual network adapters.

- Chooses the club network by the responding MA address instead of accepting whichever discovery request replies first.
- Prevents cached MA addresses from being probed with unrelated virtual-adapter reply addresses.
- Includes a matching booth profile guard for the Gaslight 10.10.1.0/24 lighting LAN.
- Retains Stop Show, White Only, the 30-second movers-only white opening, the window-crash fix, and stable macOS network identity.

The booth controller must also be updated. No fixture patch, primary executor, APC assignment, or output level is changed by installing this update.
