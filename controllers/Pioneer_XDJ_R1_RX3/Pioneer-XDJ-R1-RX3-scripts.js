// Pioneer XDJ-R1 for NauticMixxx (RX3 workflow).
//
// Based on the community "Pioneer XDJ-R1" mapping by Helton Lidio.
// MIDI addresses follow the "List of MIDI Messages" in the XDJ-R1 operating
// instructions (deck A = MIDI channel 1, deck B = channel 2, effects = channel
// 5, mixer = channel 7). The manual prints note/CC numbers in decimal; the
// values below are the same numbers in hexadecimal.
//
// Fixes over the community mapping:
//   * TEMPO slider: 14-bit (MSB CC 0x00 + LSB CC 0x20). The hardware sends 0 at
//     the "-" end and 16383 at the "+" end. The deck's rate_dir preference is
//     compensated so "-" always slows the track down, whatever the
//     "Pitch/Rate slider direction" setting is.
//   * TEMPO RANGE: notes 0x0E-0x11 select 6% / 10% / 16% / WIDE.
//   * SOUND COLOR FX: FILTER / PITCH / CRUSH / NOISE buttons (status 0x94,
//     notes 0x4E-0x51) select a QuickEffect chain on both decks.
//   * COLOR knobs: CC 0x1B (deck 1) and 0x1C (deck 2) on the mixer channel
//     drive the selected Sound Color FX. As on the hardware, COLOR does nothing
//     while no Sound Color FX is selected.

var PioneerXDJR1 = {};

PioneerXDJR1.debug = false;
PioneerXDJR1.jog_sensitivity = 9.0;
PioneerXDJR1.scratch_sensitivity = 0.5;

PioneerXDJR1.log = function(message) {
    if (PioneerXDJR1.debug) {
        console.log("XDJ-R1: " + message);
    }
};

// ---------------------------------------------------------------------------
// 14-bit helpers
// ---------------------------------------------------------------------------

// Pioneer sends MSB first, then LSB. The MSB alone is applied immediately
// (with the previous LSB), and refined when the LSB arrives. A unit that never
// sends the LSB still works with 7-bit resolution.
PioneerXDJR1.fourteenBit = {};

PioneerXDJR1.fourteenBitValue = function(key, part, value) {
    var state = PioneerXDJR1.fourteenBit[key];
    if (!state) {
        state = {msb: 0, lsb: 0};
        PioneerXDJR1.fourteenBit[key] = state;
    }
    if (part === "msb") {
        state.msb = value;
        state.lsb = 0;
    } else {
        state.lsb = value;
    }
    return ((state.msb << 7) | state.lsb) / 16383;
};

PioneerXDJR1.deckNumber = function(group) {
    var match = /Channel(\d)/.exec(group);
    return match ? Number(match[1]) : 0;
};

// ---------------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------------

PioneerXDJR1.init = function(_id, _debugging) {
    engine.softTakeover("[Channel1]", "rate", true);
    engine.softTakeover("[Channel2]", "rate", true);
    engine.softTakeover("[Master]", "crossfader", true);
    engine.softTakeover("[Master]", "volume", true);
    engine.softTakeover("[QuickEffectRack1_[Channel1]]", "super1", true);
    engine.softTakeover("[QuickEffectRack1_[Channel2]]", "super1", true);

    PioneerXDJR1.soundColorFxSelected = 0;
    PioneerXDJR1.setSoundColorFxEnabled(false);
    PioneerXDJR1.paintSoundColorFx();

    for (var deck = 1; deck <= 2; deck++) {
        var group = "[Channel" + deck + "]";
        engine.makeConnection(group, "rateRange", PioneerXDJR1.paintTempoRange);
        PioneerXDJR1.paintTempoRange(engine.getValue(group, "rateRange"), group);
    }
};

PioneerXDJR1.shutdown = function() {
    PioneerXDJR1.setSoundColorFxEnabled(false);
    for (var index = 0; index < PioneerXDJR1.soundColorFx.length; index++) {
        midi.sendShortMsg(0x94, PioneerXDJR1.soundColorFx[index].note, 0x00);
    }
};

// ---------------------------------------------------------------------------
// Jog wheels
// ---------------------------------------------------------------------------

PioneerXDJR1.jog_wheel = function(channel, control, value, status, group) {
    value = (value - 0x40) / PioneerXDJR1.jog_sensitivity;
    engine.setValue(group, "jog", value);
};

PioneerXDJR1.jog_scratch = function(channel, control, value, status, group) {
    value = (value - 0x40) / PioneerXDJR1.scratch_sensitivity;
    engine.setValue(group, "jog", value);
};

// ---------------------------------------------------------------------------
// TEMPO slider (fix: was reversed and 7-bit)
// ---------------------------------------------------------------------------

PioneerXDJR1.applyTempo = function(group, normalized) {
    // normalized: 0 at the "-" end, 1 at the "+" end (manual, p. 28).
    var speed = normalized * 2 - 1;
    // Mixxx multiplies "rate" by rate_dir. Compensate, so the physical "-"
    // end always means slower and the user preference cannot flip it.
    var direction = engine.getValue(group, "rate_dir") < 0 ? -1 : 1;
    engine.setValue(group, "rate", speed * direction);
};

PioneerXDJR1.tempoMsb = function(channel, control, value, status, group) {
    PioneerXDJR1.applyTempo(group,
        PioneerXDJR1.fourteenBitValue(group + "tempo", "msb", value));
};

PioneerXDJR1.tempoLsb = function(channel, control, value, status, group) {
    PioneerXDJR1.applyTempo(group,
        PioneerXDJR1.fourteenBitValue(group + "tempo", "lsb", value));
};

// ---------------------------------------------------------------------------
// TEMPO RANGE (fix: was unmapped)
// ---------------------------------------------------------------------------

// Notes 0x0E-0x11 = 6% / 10% / 16% / WIDE. WIDE is +/-100% as on the unit.
PioneerXDJR1.tempoRanges = [0.06, 0.10, 0.16, 1.00];
PioneerXDJR1.tempoRangeFirstNote = 0x0E;

PioneerXDJR1.tempoRangeIndex = function(range) {
    var best = 0;
    for (var index = 1; index < PioneerXDJR1.tempoRanges.length; index++) {
        if (Math.abs(PioneerXDJR1.tempoRanges[index] - range) <
                Math.abs(PioneerXDJR1.tempoRanges[best] - range)) {
            best = index;
        }
    }
    return best;
};

PioneerXDJR1.tempoRange = function(channel, control, value, status, group) {
    if (value === 0 || (status & 0xF0) === 0x80) {
        return;
    }
    var current = PioneerXDJR1.tempoRangeIndex(engine.getValue(group, "rateRange"));
    // SHIFT + TEMPO RANGE (note 0x57) always steps to the next range.
    var requested = control === 0x57 ? current :
        control - PioneerXDJR1.tempoRangeFirstNote;
    if (requested < 0 || requested >= PioneerXDJR1.tempoRanges.length) {
        return;
    }
    // The unit reports the range it switched to. If it reports the range that
    // is already active (for example, it always sends the 6% note), step to
    // the next range so the button still cycles 6 -> 10 -> 16 -> WIDE.
    var next = requested === current ?
        (current + 1) % PioneerXDJR1.tempoRanges.length : requested;
    PioneerXDJR1.log(group + " tempo range note 0x" + control.toString(16) +
        " -> " + PioneerXDJR1.tempoRanges[next]);
    engine.setValue(group, "rateRange", PioneerXDJR1.tempoRanges[next]);
};

PioneerXDJR1.paintTempoRange = function(range, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    if (deck < 1 || deck > 2) {
        return;
    }
    var selected = PioneerXDJR1.tempoRangeIndex(range);
    for (var index = 0; index < PioneerXDJR1.tempoRanges.length; index++) {
        midi.sendShortMsg(0x90 + deck - 1, PioneerXDJR1.tempoRangeFirstNote + index,
            index === selected ? 0x7F : 0x00);
    }
};

// ---------------------------------------------------------------------------
// SOUND COLOR FX + COLOR knob (fix: were unmapped)
// ---------------------------------------------------------------------------

// "preset" is the position in the QuickEffect chain preset list. NauticMixxx
// keeps RX3 REVERB, PING PONG, NOISE, FILTER at 1-4 and this mapping appends
// RX3 PITCH and RX3 CRUSH at 5-6 (see effects/chains).
// centeredAmount: the effect amount is the distance of COLOR from 12 o'clock.
// Otherwise COLOR is bipolar (FILTER: left = low-pass, right = high-pass;
// PITCH: left = down, right = up).
PioneerXDJR1.soundColorFx = [
    {name: "FILTER", note: 0x4E, preset: 4, centeredAmount: false},
    {name: "PITCH", note: 0x4F, preset: 5, centeredAmount: false},
    {name: "CRUSH", note: 0x50, preset: 6, centeredAmount: true},
    {name: "NOISE", note: 0x51, preset: 3, centeredAmount: true},
];
PioneerXDJR1.soundColorFxShiftOffset = 0x1C; // SHIFT notes 0x6A-0x6D
PioneerXDJR1.soundColorFxSelected = 0; // 0 = none, otherwise index + 1
PioneerXDJR1.colorKnobPositions = {1: 0.5, 2: 0.5};

PioneerXDJR1.soundColorFxAmount = function(normalized) {
    var selected = PioneerXDJR1.soundColorFxSelected;
    if (selected === 0) {
        return normalized;
    }
    return PioneerXDJR1.soundColorFx[selected - 1].centeredAmount ?
        Math.abs(normalized - 0.5) * 2 : normalized;
};

PioneerXDJR1.setSoundColorFxEnabled = function(enabled) {
    for (var deck = 1; deck <= 2; deck++) {
        engine.setValue("[QuickEffectRack1_[Channel" + deck + "]]", "enabled",
            enabled ? 1 : 0);
    }
};

PioneerXDJR1.paintSoundColorFx = function() {
    for (var index = 0; index < PioneerXDJR1.soundColorFx.length; index++) {
        midi.sendShortMsg(0x94, PioneerXDJR1.soundColorFx[index].note,
            index + 1 === PioneerXDJR1.soundColorFxSelected ? 0x7F : 0x00);
    }
};

PioneerXDJR1.soundColorFxButton = function(channel, control, value, status) {
    if (value === 0 || (status & 0xF0) === 0x80) {
        return;
    }
    var note = control;
    if (note >= 0x4E + PioneerXDJR1.soundColorFxShiftOffset) {
        note -= PioneerXDJR1.soundColorFxShiftOffset;
    }
    var selected = note - 0x4E + 1;
    if (selected < 1 || selected > PioneerXDJR1.soundColorFx.length) {
        return;
    }

    if (PioneerXDJR1.soundColorFxSelected === selected) {
        // Pressing the lit button again switches Sound Color FX off.
        PioneerXDJR1.soundColorFxSelected = 0;
        PioneerXDJR1.setSoundColorFxEnabled(false);
        PioneerXDJR1.paintSoundColorFx();
        PioneerXDJR1.log("Sound Color FX off");
        return;
    }

    PioneerXDJR1.soundColorFxSelected = selected;
    var fx = PioneerXDJR1.soundColorFx[selected - 1];
    for (var deck = 1; deck <= 2; deck++) {
        var group = "[QuickEffectRack1_[Channel" + deck + "]]";
        engine.setValue(group, "loaded_chain_preset", fx.preset);
        // Jump straight to the knob position: soft takeover must not block the
        // first value after a different chain was loaded.
        engine.softTakeoverIgnoreNextValue(group, "super1");
        engine.setValue(group, "super1",
            PioneerXDJR1.soundColorFxAmount(PioneerXDJR1.colorKnobPositions[deck]));
        engine.setValue(group, "enabled", 1);
    }
    PioneerXDJR1.paintSoundColorFx();
    PioneerXDJR1.log("Sound Color FX " + fx.name);
};

PioneerXDJR1.applyColor = function(deck, normalized) {
    PioneerXDJR1.colorKnobPositions[deck] = normalized;
    if (PioneerXDJR1.soundColorFxSelected === 0) {
        return;
    }
    var group = "[QuickEffectRack1_[Channel" + deck + "]]";
    engine.setValue(group, "super1", PioneerXDJR1.soundColorFxAmount(normalized));
};

// COLOR CC 0x1B/0x3B = deck 1, 0x1C/0x3C = deck 2 (status 0xB6).
PioneerXDJR1.colorMsb = function(channel, control, value) {
    var deck = control - 0x1B + 1;
    PioneerXDJR1.applyColor(deck,
        PioneerXDJR1.fourteenBitValue("color" + deck, "msb", value));
};

PioneerXDJR1.colorLsb = function(channel, control, value) {
    var deck = control - 0x3B + 1;
    PioneerXDJR1.applyColor(deck,
        PioneerXDJR1.fourteenBitValue("color" + deck, "lsb", value));
};

// ---------------------------------------------------------------------------
// Transport and mixer buttons (from the community mapping)
// ---------------------------------------------------------------------------

PioneerXDJR1.ClearCue = function(channel, control, value, status, group) {
    if (value) {
        engine.setValue(group, "cue_point", -1);
    }
};

PioneerXDJR1.headphoneLastClicked = {};
PioneerXDJR1.toggleHeadphone = function(channel, control, value, status, group) {
    var now = Date.now();
    var last = PioneerXDJR1.headphoneLastClicked[group] || 0;
    if (!value || last + 250 > now) {
        return;
    }
    PioneerXDJR1.headphoneLastClicked[group] = now;
    var enabled = !engine.getValue(group, "pfl");
    engine.setValue(group, "pfl", enabled ? 1 : 0);
    midi.sendShortMsg(0x96, control, enabled ? 0x7F : 0x00);
};

PioneerXDJR1.PlayDecks = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        return;
    }
    var playing = !engine.getValue(group, "play");
    engine.setValue(group, "play", playing ? 1 : 0);
    midi.sendShortMsg(status, 0x0B, playing ? 0x7F : 0x00);
};

PioneerXDJR1.CueDecks = function(channel, control, value, status, group) {
    if (!engine.getValue(group, "cue_default")) {
        engine.setValue(group, "cue_default", 1);
        midi.sendShortMsg(status, 0x0C, 0x7F);
        midi.sendShortMsg(status, 0x0B, 0x7F);
    } else {
        engine.setValue(group, "cue_default", 0);
        midi.sendShortMsg(status, 0x0C, 0x00);
        midi.sendShortMsg(status, 0x0B, 0x00);
    }
};

PioneerXDJR1.Sync = function(channel, control, value, status, group) {
    if (!engine.getValue(group, "beatsync")) {
        engine.setValue(group, "beatsync", 1);
        midi.sendShortMsg(status, 0x58, 0x01);
    } else {
        engine.setValue(group, "beatsync", 0);
        midi.sendShortMsg(status, 0x58, 0x00);
    }
};

PioneerXDJR1.masterTempoLastClicked = {};
PioneerXDJR1.MasterTempo = function(channel, control, value, status, group) {
    var now = Date.now();
    var last = PioneerXDJR1.masterTempoLastClicked[group] || 0;
    if (!value || last + 250 > now) {
        return;
    }
    PioneerXDJR1.masterTempoLastClicked[group] = now;
    var enabled = !engine.getValue(group, "keylock");
    engine.setValue(group, "keylock", enabled ? 1 : 0);
    midi.sendShortMsg(0x90 + PioneerXDJR1.deckNumber(group) - 1, 0x1A,
        enabled ? 0x7F : 0x00);
};

// SHIFT + SELECT press: load the highlighted track into this deck.
PioneerXDJR1.loadTrack = function(channel, control, value, status, group) {
    if (value && (status & 0xF0) !== 0x80) {
        engine.setValue(group, "LoadSelectedTrack", 1);
    }
};
