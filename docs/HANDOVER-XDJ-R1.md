# Handover: XDJ-R1 support and USB fix (for the next Claude session)

Written 2026-11-27, at the end of a session on the user's Mac. The user is
continuing on their **ASUS ROG Xbox Ally X** (Windows 11 handheld), which runs
NauticMixxx with a **Pioneer XDJ-R1** connected by USB. Read this first, then
[XDJ-R1-EN.md](XDJ-R1-EN.md).

## Where things are

- Fork: <https://github.com/monoga-my/NauticMixxxXDJR1> (fork of
  `nauticsoftware/NauticMixxx`). Work branch: `xdj-r1-support`. The fork's
  `main` was fast-forwarded to the same commits so GitHub would register the
  Windows workflow. Both are kept in step.
- Commits on top of upstream `c73631b`:
  1. XDJ-R1 preset, the PITCH/CRUSH Sound Color FX chains, packaging,
     auto-select, tests and docs.
  2. USB reader fix in `patches/0010-rekordbox-usb-only-runtime.patch`.
  3. The Windows workflow (`.github/workflows/windows-native.yml`) can now
     build in forks. Publishing a release stays limited to upstream `main`.
  4. This note and `scripts/check-rekordbox-pdb.py`.
- Windows installer build: Actions → **NauticMixxx Windows x64**, run
  `workflow_dispatch` on `xdj-r1-support` with `publish_release` unticked.
  The first run was
  [45945380961](https://github.com/monoga-my/NauticMixxxXDJR1/actions/runs/45945380961)
  (commit `04d1acb`), still running when this note was written. The artifact
  `nauticmixxx-windows-<run id>` contains `NauticMixxx-2.0.0-Windows-x64-Setup.exe`.
- On the Ally, the app keeps its profile in `%LOCALAPPDATA%\NauticMixxx`:
  `controllers\`, `effects\chains\`, `effects.xml`, `soundconfig.xml` and
  `mixxx.log`. The installer keeps an existing profile when it reinstalls.

## What the user reported, and status

| Problem | Status |
| --- | --- |
| Tempo slider reversed | Fixed in the mapping: 14-bit, compensates `rate_dir`. **Not yet checked on hardware** |
| Sound Color FX buttons and COLOR knob dead | Mapped (FILTER/PITCH/CRUSH/NOISE, COLOR CC 0x1B/0x1C). **Not yet checked on hardware** |
| Tempo Range button dead | Mapped (notes 0x0E–0x11 plus SHIFT 0x57). **Not yet checked on hardware** |
| App crashed after choosing ASIO, then would not start | Worked around: renamed `soundconfig.xml` to `soundconfig.xml.bak`. Use WASAPI; ASIO with the XDJ-R1 driver crashed the app. Cause not investigated |
| XDJ-R1 works with the mapping | Confirmed by the user on the 2.0.0 install plus `scripts/install-xdj-r1-windows.ps1` |
| USB (rekordbox export) shows ERROR | Root cause found and fixed in the patch (below). **Waiting for the Windows build to confirm** |

## The USB ERROR bug

`mixxx.log` showed: `Failed to load Rekordbox runtime session: "Invalid live
DeviceSQL row offset"`. The user's export works in Mixxx 2.6. NauticMixxx
replaces Mixxx's rekordbox reader with its own strict parser, added in patch
0010 as `src/library/rekordbox/rekordboxdatabase.cpp`.

The cause: each DeviceSQL data page ends with row groups of 36 bytes (16
offsets, presence flags, an unknown u16). Rekordbox writes the **last,
partial** group compactly: 4 bytes of flags plus 2 bytes per row. The parser
reserved a full 36 bytes, so on nearly full pages a valid last row looked like
it overlapped the row index, and the whole USB was rejected. The user's export
hit this on Artists page 125 (row 83) and Labels page 10 (row 147). The rows
decode as valid names inside the compact limit.

The fix computes the heap end as
`pageSize - (rows/16)*36 - (rows%16 ? 4 + 2*(rows%16) : 0)`. It also reads
album rows of subtype `0x84`, which keep a far u16 name offset at +22 just
like artist subtype 100, so one album no longer loses its name. Tests: the old
`ReadsBoundedRowsAndSequence` expectation was updated, and
`AcceptsRowsBesideCompactPartialRowGroup` was added. The patch still applies
cleanly with patch 0014, which touches the same file at an offset.

`scripts/check-rekordbox-pdb.py <export.pdb>` runs a Python port of the reader,
before and after the fix. On the user's USB (volume `MONOGABRARY`, 58 GB):
2.0.0 fails with exactly the logged error; fixed reads 1,754 tracks (all
titled), 25 playlists and 2,291 entries. It also leaves 897 non-fatal
"Embedded null" warnings on track string 0 (ISRC), which were already present
and harmless. **The C++ has not been compiled outside CI**, because there was
no Qt on the Mac. The Windows workflow is the first compile and test run.

## Mapping design decisions (and why)

- MIDI addresses come from the XDJ-R1 manual's "List of MIDI Messages"
  (pp. 28–33). The manual prints note/CC numbers in **decimal**; the XML uses
  hex. Deck A = channel 1 (0x90/0xB0), deck B = channel 2, FX = channel 5
  (0x94), mixer = channel 7 (0x96/0xB6).
- Tempo: MSB CC 0x00 + LSB 0x20. 0 = "−" end, 16383 = "+" end. The script
  sets `rate = speed * rate_dir` so the "Pitch/Rate slider direction"
  preference cannot flip it.
- Tempo Range: the manual lists one note per range. It is unclear whether the
  unit sends the note of the new range or always the same note, so the script
  handles both. Repeating the active range's note steps to the next range.
  WIDE = rateRange 1.0.
- Sound Color FX use `loaded_chain_preset` indexes into the QuickEffect preset
  list. NauticMixxx pins REVERB, PING PONG, NOISE, FILTER at 1–4. This branch
  appends **RX3 PITCH (5)** and **RX3 CRUSH (6)** everywhere that list is
  enforced (profile scripts, installers, uninstaller, Linux launcher, tests).
  FILTER and PITCH are bipolar; CRUSH and NOISE use the distance from centre.
  COLOR does nothing while no FX is selected, as on the hardware.
- PITCH/CRUSH chains use the built-in effect IDs `org.mixxx.effects.pitchshift`
  (param `pitch`) and `org.mixxx.effects.bitcrusher` (`bit_depth`,
  `downsample`, linked inverted). These param IDs were written from memory and
  are **unverified**.
- Browser: the XDJ-R1 has no LOAD buttons. SELECT turn/press drive
  NauticMixxx's own RX3 browser (shared `Nautic-RX3-Browser.js` and
  `Nautic-RX3-Encoder-Pioneer-Roland.js` from `controllers/Pioneer_Roland_RX3`).
  **SHIFT + SELECT press loads** into that deck. BACK goes back,
  SHIFT + BACK = VIEW, SHIFT + TIME = SOURCE. The original community mapping
  loaded on a plain press; the user has been told about this change.
- Auto-select: patch 0016 maps a MIDI port name containing `XDJ-R1` to
  `Pioneer-XDJ-R1-RX3.midi.xml`. This works only in builds from this branch.

## Next steps

1. When the build finishes: if it failed, read the failing step's log
   (`gh run view <id> --log-failed -R monoga-my/NauticMixxxXDJR1`) and fix it.
   The most likely place is the new C++ or its tests in patch 0010. If it
   passed, the user installs the artifact on the Ally with NauticMixxx closed.
2. Confirm the USB loads under SOURCE (tracks, playlists, album/artist names).
   If it still fails, grep `mixxx.log` for `ekordbox` and run the checker on
   `<USB>\PIONEER\rekordbox\export.pdb`.
3. Hardware checks with the user, in this order: tempo direction across the
   full range; TEMPO RANGE cycling and LEDs; each Sound Color FX and COLOR on
   both decks (do PITCH/CRUSH sound right?); browser and SHIFT + SELECT
   loading; jogs; headphone CUE; MASTER TEMPO.
4. For quick mapping tweaks on the Ally, edit the files in
   `%LOCALAPPDATA%\NauticMixxx\controllers\` directly and have the user
   re-enable the controller (Preferences → Controllers). Copy fixes back into
   `controllers/Pioneer_XDJ_R1_RX3/` and run `node scripts/test-xdj-r1-preset.js`.
   `PioneerXDJR1.debug = true` plus `--controller-debug` logs the MIDI it
   receives.
5. Optionally, look into why ASIO crashed the app with the XDJ-R1 driver.

## Tests to run after changes

```
node scripts/test-xdj-r1-preset.js
node scripts/test-rx3-sound-color-fx.js
python3 scripts/test-rx3-controller-package.py
python3 scripts/test-windows-installer-contract.py
```

## Setup notes for Windows

- GitHub CLI: `winget install GitHub.cli`, then
  `gh auth login --hostname github.com --git-protocol https --web` and
  `gh auth setup-git`. On the Mac, the interactive "Authenticate Git?" prompt
  could not be answered in the app's Terminal panel. Running with
  `< /dev/null` avoided it. In PowerShell the equivalent is
  `$null | gh auth login ...`. Pushing workflow-file
  changes needs the `workflow` scope:
  `gh auth refresh --hostname github.com --scopes workflow`.
- Git commits use the user's configured git identity.
