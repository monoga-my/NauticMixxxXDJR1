#!/usr/bin/env python3
"""Generate controllers/Pioneer_XDJ_R1_RX3/Pioneer-XDJ-R1-RX3.midi.xml.

    python3 scripts/generate-xdj-r1-preset.py

Addresses come from the XDJ-R1 manual's "List of MIDI Messages" (pp. 28-33),
which prints note/CC numbers in decimal. Deck A = 0x90/0xB0, deck B =
0x91/0xB1, Beat FX deck A = 0x94/0xB4, deck B = 0x95/0xB5, mixer = 0x96/0xB6.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "controllers/Pioneer_XDJ_R1_RX3/Pioneer-XDJ-R1-RX3.midi.xml"
SCRIPT = "script-binding"
controls = []


def control(group, key, status, midino, description, option="normal"):
    controls.append(f"""            <control>
                <description>{description}</description>
                <group>{group}</group>
                <key>{key}</key>
                <status>0x{status:02X}</status>
                <midino>0x{midino:02X}</midino>
                <options>
                    <{option}/>
                </options>
            </control>""")


def script(group, key, status, midino, description):
    control(group, "PioneerXDJR1." + key, status, midino, description, SCRIPT)


def comment(text):
    controls.append(f"            <!-- {text} -->")


comment("Mixer (MIDI channel 7)")
control("[Master]", "volume", 0xB6, 0x00, "MASTER LEVEL")
control("[Master]", "headMix", 0xB6, 0x01, "HEADPHONES MIXING")
control("[Master]", "headGain", 0xB6, 0x02, "HEADPHONES LEVEL")
control("[Master]", "crossfader", 0xB6, 0x1F, "Crossfader")
control("[Microphone]", "volume", 0xB6, 0x14, "MIC LEVEL")
control("[Microphone]", "talkover", 0x96, 0x46, "MIC ON/OFF")
for deck in (1, 2):
    channel = f"[Channel{deck}]"
    eq = f"[EqualizerRack1_{channel}_Effect1]"
    control(channel, "pregain", 0xB6, 0x02 + deck, f"TRIM deck {deck}")
    control(eq, "parameter3", 0xB6, 0x06 + deck, f"EQ HI deck {deck}")
    control(eq, "parameter2", 0xB6, 0x0A + deck, f"EQ MID deck {deck}")
    control(eq, "parameter1", 0xB6, 0x0E + deck, f"EQ LOW deck {deck}")
    control(channel, "volume", 0xB6, 0x13 if deck == 1 else 0x15, f"Channel fader deck {deck}")
    script(channel, "toggleHeadphone", 0x96, 0x53 + deck, f"HEADPHONES CUE deck {deck}")

comment("COLOR knobs (14-bit) drive the selected Sound Color FX")
for deck in (1, 2):
    quick = f"[QuickEffectRack1_[Channel{deck}]]"
    script(quick, "colorMsb", 0xB6, 0x1A + deck, f"COLOR deck {deck} (MSB)")
    script(quick, "colorLsb", 0xB6, 0x3A + deck, f"COLOR deck {deck} (LSB)")

comment("SOUND COLOR FX buttons; SHIFT variants behave the same")
for index, name in enumerate(["FILTER", "PITCH", "CRUSH", "NOISE"]):
    script("[QuickEffectRack1_[Channel1]]", "soundColorFxButton", 0x94, 0x4E + index,
           f"SOUND COLOR FX {name}")
    script("[QuickEffectRack1_[Channel1]]", "soundColorFxButton", 0x94, 0x6A + index,
           f"SHIFT + SOUND COLOR FX {name}")

for deck in (1, 2):
    channel = f"[Channel{deck}]"
    note = 0x90 + deck - 1
    cc = 0xB0 + deck - 1
    fx_note = 0x94 + deck - 1
    fx_cc = 0xB4 + deck - 1
    unit = f"[EffectRack1_EffectUnit{deck + 2}]"

    comment(f"Deck {deck} transport (MIDI channel {deck})")
    script(channel, "PlayDecks", note, 0x0B, "PLAY/PAUSE")
    script(channel, "CueDecks", note, 0x0C, "CUE")
    script(channel, "ClearCue", note, 0x48, "SHIFT + CUE: clear cue point")
    control(channel, "fwd", note, 0x09, "TRACK SEARCH forward")
    control(channel, "back", note, 0x0A, "TRACK SEARCH back")
    script(channel, "Sync", note, 0x58, "SYNC (stays on; lit while on)")
    script(channel, "Master", note, 0x59, "MASTER: make this deck the sync leader")
    script(channel, "MasterTempo", note, 0x1A, "MASTER TEMPO (keylock)")
    script(channel, "quantizeButton", note, 0x56,
           "SHIFT + MASTER TEMPO: quantize on/off (both decks; lamp keeps showing keylock)")

    comment(f"Deck {deck} tempo")
    script(channel, "tempoMsb", cc, 0x00, "TEMPO slider (MSB)")
    script(channel, "tempoLsb", cc, 0x20, "TEMPO slider (LSB)")
    for index, name in enumerate(["6%", "10%", "16%", "WIDE"]):
        script(channel, "tempoRange", note, 0x0E + index, f"TEMPO RANGE {name}")
    script(channel, "tempoRange", note, 0x57, "SHIFT + TEMPO RANGE: next range")

    comment(f"Deck {deck} jog and VINYL")
    script(channel, "vinylButton", note, 0x15, "VINYL on/off")
    script(channel, "vinylButton", note, 0x16, "SHIFT + VINYL on/off")
    script(channel, "jog_wheel", cc, 0x01, "Jog side: pitch bend")
    script(channel, "jogTop", cc, 0x02, "Jog top: scratch in VINYL mode, else pitch bend")
    script(channel, "platterTouch", note, 0x36, "Jog top touched")
    script(channel, "platterTouch", note, 0x67, "SHIFT + jog top touched")

    comment(f"Deck {deck} AUTO BEAT LOOP")
    script(channel, "autoLoopPress", note, 0x14, "AUTO BEAT LOOP press: loop on/off")
    script(channel, "autoLoopShiftPress", note, 0x50, "SHIFT + AUTO BEAT LOOP: reloop")
    script(channel, "autoLoopTurn", cc, 0x13, "AUTO BEAT LOOP turn: halve/double")
    script(channel, "autoLoopShiftTurn", cc, 0x4F, "SHIFT + AUTO BEAT LOOP turn: beat jump")

    comment(f"Deck {deck} HOT CUE section (MODE switches to the KEY layer)")
    script(channel, "modeButton", note, 0x3B, "MODE: HOT CUE / KEY layer")
    script(channel, "modeButton", note, 0x3C, "SHIFT + MODE: HOT CUE / KEY layer")
    for midino, name in [(0x2E, "A"), (0x2F, "B"), (0x30, "C"), (0x19, "CALL (hot cue D)"),
                         (0x32, "A (sampler mode)"), (0x33, "B (sampler mode)"),
                         (0x34, "C (sampler mode)")]:
        script(channel, "pad", note, midino, f"HOT CUE {name}")
    for midino, name in [(0x5F, "A"), (0x60, "B"), (0x61, "C"), (0x55, "CALL"),
                         (0x63, "A (sampler mode)"), (0x64, "B (sampler mode)"),
                         (0x65, "C (sampler mode)")]:
        script(channel, "pad", note, midino, f"SHIFT + HOT CUE {name}: delete")

    comment(f"Deck {deck} Beat FX (MIDI channel {deck + 4}, effect unit {deck + 2})")
    for index, name in enumerate(["TRANS", "FLANGER", "ECHO", "ROLL"]):
        script(unit, "beatFxButton", fx_note, 0x46 + index, f"FX SELECT {name}")
        script(unit, "beatFxButton", fx_note, 0x62 + index, f"SHIFT + FX SELECT {name}")
    script(unit, "beatFxBeat", fx_cc, 0x00, "BEAT")
    script(unit, "beatFxBeat", fx_cc, 0x10, "SHIFT + BEAT")
    script(unit, "beatFxLevelMsb", fx_cc, 0x02, "LEVEL/DEPTH (MSB)")
    script(unit, "beatFxLevelLsb", fx_cc, 0x22, "LEVEL/DEPTH (LSB)")
    script(unit, "beatFxLevelMsb", fx_cc, 0x12, "SHIFT + LEVEL/DEPTH (MSB)")
    script(unit, "beatFxLevelLsb", fx_cc, 0x32, "SHIFT + LEVEL/DEPTH (LSB)")
    script(unit, "keepLowsButton", fx_note, 0x74,
           "SHIFT + TAP: Beat FX on the mids and highs only (lows stay dry)")

    comment(f"Browser, deck {deck} side")
    script("[Library]", "selectTurn", cc, 0x40,
           "SELECT turn: browse; in PERFORMANCE zoom the waveforms")
    script("[Library]", "selectTurn", cc, 0x41,
           "SHIFT + SELECT turn: browse; in PERFORMANCE zoom the waveforms")
    script(channel, "selectPress", note, 0x42,
           f"SELECT press: load into deck {deck} on the track list, else open/enter")
    control("[Library]", "NauticRX3Browser.enter", note, 0x43,
            "SHIFT + SELECT press: always open/enter (never loads)", SCRIPT)
    control("[Library]", "NauticRX3Browser.back", note, 0x44,
            "BACK: browser back one level", SCRIPT)
    control("[Library]", "NauticRX3Browser.view", note, 0x45,
            "SHIFT + BACK: VIEW (PERFORMANCE / BROWSE)", SCRIPT)
    script("[Library]", "matchButton", note, 0x3E,
           "TIME in BROWSE: MATCH filter (master deck key, tempo within 16%)")
    control("[Library]", "NauticRX3Browser.source", note, 0x3F,
            "SHIFT + TIME: SOURCE", SCRIPT)

xml = f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/generate-xdj-r1-preset.py; edit that script instead. -->
<MixxxControllerPreset mixxxVersion="2.5.0+" schemaVersion="1">
    <info>
        <name>Pioneer XDJ-R1 (NauticMixxx RX3)</name>
        <author>Helton Lidio; NauticMixxx XDJ-R1 adaptation</author>
        <description>Pioneer XDJ-R1 in MIDI mode, 2 decks on MIDI channels 1 and 2: 14-bit tempo, TEMPO RANGE, SOUND COLOR FX and COLOR, Beat FX, AUTO BEAT LOOP, hot cues with a KEY layer, VINYL mode, SYNC/MASTER and level meters, and the NauticMixxx RX3 browser.</description>
        <forums>https://github.com/nauticsoftware/NauticMixxx/issues</forums>
    </info>
    <controller id="XDJ-R1">
        <scriptfiles>
            <file functionprefix="PioneerXDJR1" filename="Pioneer-XDJ-R1-RX3-scripts.js"/>
            <file functionprefix="NauticRX3Browser" filename="Nautic-RX3-Browser.js"/>
            <file functionprefix="NauticRX3Encoder" filename="Nautic-RX3-Encoder-Pioneer-Roland.js"/>
        </scriptfiles>
        <controls>
{chr(10).join(controls)}
        </controls>
        <outputs/>
    </controller>
</MixxxControllerPreset>
"""
OUTPUT.write_text(xml, encoding="utf-8")
print(f"Wrote {OUTPUT.relative_to(ROOT)} with {sum(1 for c in controls if '<control>' in c)} controls")
