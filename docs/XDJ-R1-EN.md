# Pioneer XDJ-R1 in NauticMixxx

Files: `controllers/Pioneer_XDJ_R1_RX3/` and the Sound Color FX chains
`effects/chains/RX3 PITCH.xml` and `RX3 CRUSH.xml`. The preset uses the shared
`Nautic-RX3-Browser.js` and `Nautic-RX3-Encoder-Pioneer-Roland.js` from
`controllers/Pioneer_Roland_RX3/`, which the installers copy to the same folder.

The preset is based on Helton Lidio's community "Pioneer XDJ-R1" Mixxx mapping.
Its MIDI addresses were checked against the List of MIDI Messages in the XDJ-R1
operating instructions. The manual prints note and CC numbers in decimal. The
XML uses hexadecimal.

## What changed compared with the community mapping

| Control | Before | Now |
| --- | --- | --- |
| TEMPO slider | 7-bit `rate`, backwards | 14-bit (CC 0x00 + 0x20). The **−** end always slows the track, whatever the *Pitch/Rate slider direction* preference says |
| TEMPO RANGE | Not mapped | 6% / 10% / 16% / WIDE (±100%), notes 0x0E–0x11, with LED feedback. SHIFT + TEMPO RANGE steps to the next range |
| SOUND COLOR FX | Not mapped | FILTER, PITCH, CRUSH, NOISE (status 0x94, notes 0x4E–0x51; SHIFT 0x6A–0x6D). Press a button to select that FX for both decks. Press it again to turn it off |
| COLOR knobs | Not mapped | CC 0x1B (deck 1) and 0x1C (deck 2), 14-bit. They control the selected FX. As on the hardware, they do nothing while no FX is selected |
| Browser | Stock Mixxx `[Playlist]` controls, which do not drive the NauticMixxx USB browser | NauticMixxx RX3 browser (see below) |
| HEADPHONES CUE, MASTER TEMPO, PLAY, CUE, SYNC, jogs, EQ, TRIM, faders, crossfader, MIC | Mapped | Kept, with LED state taken from the engine |

How each Sound Color FX responds to COLOR:

| Button | QuickEffect preset | COLOR behavior |
| --- | --- | --- |
| FILTER | RX3 FILTER (4) | Left of centre = low-pass, right = high-pass |
| PITCH | RX3 PITCH (5) | Left = pitch down, right = pitch up |
| CRUSH | RX3 CRUSH (6) | Amount grows as you turn away from centre, in either direction |
| NOISE | RX3 NOISE (3) | Amount grows as you turn away from centre, in either direction |

The numbers are positions in the Quick Effect preset list. The installers and
`scripts/install-xdj-r1-windows.ps1` put the presets in this order: REVERB,
PING PONG, NOISE, FILTER, PITCH, CRUSH. If you reorder them in
**Preferences > Effects**, the buttons load the wrong effects.

## Browser controls

| Gesture | Result |
| --- | --- |
| Turn SELECT (either deck) | Move through BROWSE |
| Press SELECT | Open BROWSE, or enter the highlighted source/folder. Hold for 2 s to go back one level |
| SHIFT + press SELECT | Load the highlighted track into **that** deck |
| BACK | Go back one level |
| SHIFT + BACK | VIEW: switch between PERFORMANCE and BROWSE |
| SHIFT + TIME | SOURCE |

In the community mapping, a plain SELECT press loaded the track. The XDJ-R1 has
no separate LOAD buttons, so loading moved to SHIFT + SELECT. That leaves the
plain press free to navigate the NauticMixxx browser.

## Windows 11 (including handheld PCs such as the ROG Xbox Ally X)

1. Install Pioneer's **XDJ-R1 driver** for Windows. You need it for both audio
   and MIDI.
2. Connect the XDJ-R1 by USB. On a handheld with only USB-C ports, use a USB-C
   to USB-B cable or a powered hub. Switch both decks of the unit to MIDI
   (DJ software) control, as described in "Using the DJ software" in its
   manual.
3. Pick one of these:
   * **Official 2.0.0 installer + this preset (no compiling).** Install
     NauticMixxx 2.0.0 and start it once. Close it. Then, from this repository
     folder, run:
     `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-xdj-r1-windows.ps1`
   * **Full custom build.** Follow [BUILDING.md](BUILDING.md):
     `./scripts/build-mixxx-rx3-windows.ps1 -WorkRoot C:\nauticmixxx-build -Jobs 4`.
     This build includes the preset and auto-selects it when the MIDI port
     name contains `XDJ-R1`.
4. In NauticMixxx, open **Preferences > Sound Hardware**. Choose the XDJ-R1
   ASIO device (or WASAPI if ASIO is not offered). Set Main to the XDJ-R1
   master output and Headphones to its cue output. A 256–512 sample buffer is
   a safe start on a handheld. Use the *Performance* power profile and keep
   the device on mains power while playing.
5. In **Preferences > Controllers**, select the XDJ-R1. Choose
   **Pioneer XDJ-R1 (NauticMixxx RX3)** and tick **Enabled**. The official
   build does not auto-select this preset.

## Not yet confirmed on hardware

These were checked only in software, by `node scripts/test-xdj-r1-preset.js`:

* Whether the unit lights the Sound Color FX and TEMPO RANGE LEDs from MIDI
  input. The manual lists those notes only as inputs.
* The parameter IDs used by the RX3 PITCH and RX3 CRUSH chains
  (`pitch`, `bit_depth`, `downsample`).
* Whether TEMPO RANGE sends a separate note for each range, or the same note on
  every press. The script handles both cases.

If a control misbehaves, set `PioneerXDJR1.debug = true` at the top of
`Pioneer-XDJ-R1-RX3-scripts.js`. Then start NauticMixxx with
`--controller-debug` and note what it logs.
