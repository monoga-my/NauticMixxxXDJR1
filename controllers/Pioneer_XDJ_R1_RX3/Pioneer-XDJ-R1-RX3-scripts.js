// Pioneer XDJ-R1 for NauticMixxx (RX3 workflow).
//
// Based on the community "Pioneer XDJ-R1" mapping by Helton Lidio.
// MIDI addresses follow the "List of MIDI Messages" in the XDJ-R1 operating
// instructions: deck A = MIDI channel 1 (0x90/0xB0), deck B = channel 2,
// Beat FX deck A = channel 5 (0x94/0xB4), deck B = channel 6 (0x95/0xB5),
// mixer = channel 7 (0x96/0xB6). The manual prints note/CC numbers in decimal;
// the values below are the same numbers in hexadecimal.
//
//   * TEMPO slider: 14-bit (CC 0x00 + 0x20). "-" always slows the track down,
//     whatever the "Pitch/Rate slider direction" preference is.
//   * TEMPO RANGE: 6% / 10% / 16% / WIDE.
//   * SOUND COLOR FX + COLOR: QuickEffect chains on both decks.
//   * Beat FX: TRANS / FLANGER / ECHO drive NauticMixxx's own Beat FX (effect
//     unit 1, shown in the BEAT FX panel), ROLL is a loop roll. BEAT sets the
//     time, LEVEL/DEPTH the mix.
//   * PLAY / CUE behave like a CDJ. TIME in BROWSE = MATCH filter.
//   * AUTO BEAT LOOP: press = loop (last size, 4 beats at first), turn =
//     halve/double.
//   * HOT CUE section: A, B, C and CALL are hot cues 1-4. MODE switches to the
//     KEY layer: A = key up, B = key down, C = match key, CALL = reset key.
//   * VINYL: on = touch the platter top to scratch, the side bends pitch.
//     Off = CDJ mode, the whole platter bends pitch.
//   * SYNC / MASTER with lights, channel level meters on the unit.
//   * SELECT press loads the highlighted track into that deck when the track
//     list is focused, and otherwise opens BROWSE or enters the folder.

var PioneerXDJR1 = {};

PioneerXDJR1.debug = false;
PioneerXDJR1.jog_sensitivity = 9.0;

PioneerXDJR1.log = function(message) {
    if (PioneerXDJR1.debug) {
        console.log("XDJ-R1: " + message);
    }
};

PioneerXDJR1.isPress = function(value, status) {
    return value > 0 && (status & 0xF0) !== 0x80;
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

PioneerXDJR1.deckStatus = function(deck) {
    return 0x90 + deck - 1;
};

// Relative encoders: 1..30 clockwise, 98..127 (= -30..-1) counter-clockwise.
PioneerXDJR1.encoderDelta = function(value) {
    return value > 0x40 ? value - 0x80 : value;
};

// ---------------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------------

PioneerXDJR1.connections = [];

PioneerXDJR1.connect = function(group, key, callback) {
    var connection = engine.makeConnection(group, key, callback);
    if (connection) {
        PioneerXDJR1.connections.push(connection);
        connection.trigger();
    }
    return connection;
};

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
        PioneerXDJR1.connect(group, "rateRange", PioneerXDJR1.paintTempoRange);
        PioneerXDJR1.connect(group, "sync_enabled", PioneerXDJR1.paintSync);
        PioneerXDJR1.connect(group, "sync_leader", PioneerXDJR1.paintMaster);
        PioneerXDJR1.connect(group, "loop_enabled", PioneerXDJR1.paintLoop);
        PioneerXDJR1.connect(group, "beatloop_size", PioneerXDJR1.paintLoopSize);
        PioneerXDJR1.connect(group, "pitch_adjust", PioneerXDJR1.paintPads);
        for (var cue = 1; cue <= 4; cue++) {
            PioneerXDJR1.connect(group, "hotcue_" + cue + "_status", PioneerXDJR1.paintPads);
        }
        if (!PioneerXDJR1.connect(group, "vu_meter", PioneerXDJR1.paintVuMeter)) {
            PioneerXDJR1.connect(group, "VuMeter", PioneerXDJR1.paintVuMeter);
        }
        PioneerXDJR1.padLayer[deck] = "hotcue";
        PioneerXDJR1.paintPads(0, group);
        PioneerXDJR1.paintVinyl(deck);
        PioneerXDJR1.connect(group, "play_indicator", PioneerXDJR1.paintPlay);
        PioneerXDJR1.connect(group, "cue_indicator", PioneerXDJR1.paintCue);
    }
    PioneerXDJR1.initBeatFx();
};

PioneerXDJR1.shutdown = function() {
    PioneerXDJR1.setSoundColorFxEnabled(false);
    for (var index = 0; index < PioneerXDJR1.soundColorFx.length; index++) {
        midi.sendShortMsg(0x94, PioneerXDJR1.soundColorFx[index].note, 0x00);
    }
    for (var deck = 1; deck <= 2; deck++) {
        PioneerXDJR1.stopBeatFx(deck);
        midi.sendShortMsg(0xB6, 0x47 + deck - 1, 0x00);
        midi.sendShortMsg(PioneerXDJR1.deckStatus(deck), 0x0B, 0x00);
        midi.sendShortMsg(PioneerXDJR1.deckStatus(deck), 0x0C, 0x00);
    }
};

// ---------------------------------------------------------------------------
// Jog wheels and VINYL mode
// ---------------------------------------------------------------------------

// One full turn of the platter is 600 ticks (manual, p. 29).
PioneerXDJR1.jogTicksPerTurn = 600;
PioneerXDJR1.vinylMode = {1: true, 2: true};
PioneerXDJR1.platterTouched = {1: false, 2: false};
// Keep vinyl scratch active after lifting off the platter top until the
// spinning wheel stops sending ticks (so backspins play out naturally).
PioneerXDJR1.scratchActive = {1: false, 2: false};
PioneerXDJR1.scratchReleaseTimer = {1: 0, 2: 0};
PioneerXDJR1.scratchReleaseMs = 120;

PioneerXDJR1.clearScratchTimer = function(deck) {
    if (PioneerXDJR1.scratchReleaseTimer[deck]) {
        engine.stopTimer(PioneerXDJR1.scratchReleaseTimer[deck]);
        PioneerXDJR1.scratchReleaseTimer[deck] = 0;
    }
};

PioneerXDJR1.scheduleScratchRelease = function(deck) {
    PioneerXDJR1.clearScratchTimer(deck);
    PioneerXDJR1.scratchReleaseTimer[deck] = engine.beginTimer(
        PioneerXDJR1.scratchReleaseMs, function() {
            PioneerXDJR1.scratchReleaseTimer[deck] = 0;
            if (!PioneerXDJR1.platterTouched[deck] && PioneerXDJR1.scratchActive[deck]) {
                PioneerXDJR1.scratchActive[deck] = false;
                engine.scratchDisable(deck, true);
            }
        }, true);
};

PioneerXDJR1.paintVinyl = function(deck) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(deck), 0x15,
        PioneerXDJR1.vinylMode[deck] ? 0x7F : 0x00);
};

PioneerXDJR1.vinylButton = function(channel, control, value, status, group) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    var deck = PioneerXDJR1.deckNumber(group);
    PioneerXDJR1.vinylMode[deck] = !PioneerXDJR1.vinylMode[deck];
    if (!PioneerXDJR1.vinylMode[deck] &&
            (PioneerXDJR1.platterTouched[deck] || PioneerXDJR1.scratchActive[deck])) {
        PioneerXDJR1.clearScratchTimer(deck);
        PioneerXDJR1.platterTouched[deck] = false;
        PioneerXDJR1.scratchActive[deck] = false;
        engine.scratchDisable(deck);
    }
    PioneerXDJR1.paintVinyl(deck);
};

// Platter top touched / released (note 0x36).
PioneerXDJR1.platterTouch = function(channel, control, value, status, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var touched = PioneerXDJR1.isPress(value, status);
    if (touched && PioneerXDJR1.vinylMode[deck]) {
        PioneerXDJR1.clearScratchTimer(deck);
        PioneerXDJR1.platterTouched[deck] = true;
        PioneerXDJR1.scratchActive[deck] = true;
        if (!engine.isScratching(deck)) {
            engine.scratchEnable(deck, PioneerXDJR1.jogTicksPerTurn, 33 + 1 / 3,
                1 / 8, (1 / 8) / 32);
        }
    } else if (!touched && PioneerXDJR1.platterTouched[deck]) {
        PioneerXDJR1.platterTouched[deck] = false;
        // Keep scratching while the wheel continues spinning; disable once
        // ticks stop arriving.
        PioneerXDJR1.scheduleScratchRelease(deck);
    }
};

// Platter top turned (CC 0x02): scratch while touched or coasting in VINYL mode.
PioneerXDJR1.jogTop = function(channel, control, value, status, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var delta = value - 0x40;
    if (PioneerXDJR1.scratchActive[deck] && engine.isScratching(deck)) {
        engine.scratchTick(deck, delta);
        if (!PioneerXDJR1.platterTouched[deck]) {
            PioneerXDJR1.scheduleScratchRelease(deck);
        }
    } else {
        engine.setValue(group, "jog", delta / PioneerXDJR1.jog_sensitivity);
    }
};

// Platter side turned (CC 0x01), and the top in CDJ mode: bend the tempo, or
// keep feeding a coasting vinyl spinback after the hand lifts off the top.
PioneerXDJR1.jog_wheel = function(channel, control, value, status, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var delta = value - 0x40;
    if (PioneerXDJR1.scratchActive[deck] && !PioneerXDJR1.platterTouched[deck] &&
            engine.isScratching(deck)) {
        engine.scratchTick(deck, delta);
        PioneerXDJR1.scheduleScratchRelease(deck);
        return;
    }
    engine.setValue(group, "jog", delta / PioneerXDJR1.jog_sensitivity);
};

// ---------------------------------------------------------------------------
// TEMPO slider
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
// TEMPO RANGE
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
    if (!PioneerXDJR1.isPress(value, status)) {
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
    engine.setValue(group, "rateRange", PioneerXDJR1.tempoRanges[next]);
};

PioneerXDJR1.paintTempoRange = function(range, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    if (deck < 1 || deck > 2) {
        return;
    }
    var selected = PioneerXDJR1.tempoRangeIndex(range);
    for (var index = 0; index < PioneerXDJR1.tempoRanges.length; index++) {
        midi.sendShortMsg(PioneerXDJR1.deckStatus(deck),
            PioneerXDJR1.tempoRangeFirstNote + index, index === selected ? 0x7F : 0x00);
    }
};

// ---------------------------------------------------------------------------
// SYNC / MASTER (persistent SYNC, as in the other NauticMixxx Pioneer presets)
// ---------------------------------------------------------------------------

PioneerXDJR1.Sync = function(channel, control, value, status, group) {
    if (!PioneerXDJR1.isPress(value, status) || engine.getValue(group, "rx3_source_lost")) {
        return;
    }
    if (engine.getValue(group, "sync_enabled")) {
        engine.setValue(group, "sync_enabled", 0);
    } else {
        engine.setValue(group, "sync_enabled", 1);
        engine.setValue(group, "beatsync_phase", 1);
    }
};

PioneerXDJR1.Master = function(channel, control, value, status, group) {
    if (!PioneerXDJR1.isPress(value, status) || engine.getValue(group, "rx3_source_lost")) {
        return;
    }
    engine.setValue(group, "sync_leader", engine.getValue(group, "sync_leader") > 0 ? 0 : 1);
};

PioneerXDJR1.paintSync = function(value, group) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x58,
        value > 0 ? 0x7F : 0x00);
};

PioneerXDJR1.paintMaster = function(value, group) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x59,
        value > 0 ? 0x7F : 0x00);
};

// ---------------------------------------------------------------------------
// Channel level meters (B6 0x47 = deck A, 0x48 = deck B; 0-127)
// ---------------------------------------------------------------------------

PioneerXDJR1.lastVu = {1: -1, 2: -1};

PioneerXDJR1.paintVuMeter = function(value, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var level = Math.max(0, Math.min(127, Math.round(value * 127)));
    if (level === PioneerXDJR1.lastVu[deck]) {
        return;
    }
    PioneerXDJR1.lastVu[deck] = level;
    midi.sendShortMsg(0xB6, 0x47 + deck - 1, level);
};

// ---------------------------------------------------------------------------
// AUTO BEAT LOOP
// ---------------------------------------------------------------------------

// Press: exit the active loop, or start one of the deck's current loop size
// (Mixxx starts every deck at 4 beats and remembers the last size).
PioneerXDJR1.autoLoopPress = function(channel, control, value, status, group) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    if (engine.getValue(group, "loop_enabled")) {
        engine.setValue(group, "reloop_toggle", 1);
    } else {
        engine.setValue(group, "beatloop_activate", 1);
    }
};

// SHIFT + press: re-enter the last loop.
PioneerXDJR1.autoLoopShiftPress = function(channel, control, value, status, group) {
    if (PioneerXDJR1.isPress(value, status)) {
        engine.setValue(group, "reloop_toggle", 1);
    }
};

// Turn: right doubles, left halves the loop (and the size of the next loop).
PioneerXDJR1.autoLoopTurn = function(channel, control, value, status, group) {
    var delta = PioneerXDJR1.encoderDelta(value);
    if (delta > 0) {
        engine.setValue(group, "loop_double", 1);
    } else if (delta < 0) {
        engine.setValue(group, "loop_halve", 1);
    }
};

// SHIFT + turn: move the loop (or the play position) by one beat-jump.
PioneerXDJR1.autoLoopShiftTurn = function(channel, control, value, status, group) {
    var delta = PioneerXDJR1.encoderDelta(value);
    if (delta !== 0) {
        engine.setValue(group, delta > 0 ? "beatjump_forward" : "beatjump_backward", 1);
    }
};

PioneerXDJR1.paintLoop = function(value, group) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x14,
        value > 0 ? 0x7F : 0x00);
};

// The unit shows the loop length from notes 0x6E (32 beats) to 0x78 (1/32).
PioneerXDJR1.loopSizeNotes = [32, 16, 8, 4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16, 1 / 32];

PioneerXDJR1.paintLoopSize = function(size, group) {
    var status = PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group));
    for (var index = 0; index < PioneerXDJR1.loopSizeNotes.length; index++) {
        if (Math.abs(PioneerXDJR1.loopSizeNotes[index] - size) < 1e-6) {
            midi.sendShortMsg(status, 0x6E + index, 0x7F);
        }
    }
};

// ---------------------------------------------------------------------------
// HOT CUE section: hot cues A, B, C, D (CALL) and the KEY layer (MODE)
// ---------------------------------------------------------------------------

// The unit sends different notes for its HOT CUE and 4-BEAT SAMPLER modes;
// both sets are treated as the same three buttons.
PioneerXDJR1.padNotes = {
    0x2E: 1, 0x2F: 2, 0x30: 3, 0x19: 4, // A, B, C, CALL
    0x32: 1, 0x33: 2, 0x34: 3, // A-C in 4-BEAT SAMPLER mode
};
PioneerXDJR1.padShiftNotes = {
    0x5F: 1, 0x60: 2, 0x61: 3, 0x55: 4,
    0x63: 1, 0x64: 2, 0x65: 3,
};
PioneerXDJR1.padLayer = {1: "hotcue", 2: "hotcue"};

// MODE: the XDJ-R1 sends MODE as its own HOT CUE / 4-BEAT SAMPLER state:
// 0x7F when it switches to sampler mode, 0x00 when it switches back, one
// message per press. A 0x00 that arrives soon after a 0x7F is a plain button
// release instead (in case a unit sends press and release), and is ignored.
PioneerXDJR1.modeReleaseMs = 400;
PioneerXDJR1.modeLastOn = {1: 0, 2: 0};
PioneerXDJR1.modeButton = function(channel, control, value, status, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var now = Date.now();
    if (PioneerXDJR1.isPress(value, status)) {
        PioneerXDJR1.modeLastOn[deck] = now;
    } else if (now - PioneerXDJR1.modeLastOn[deck] < PioneerXDJR1.modeReleaseMs) {
        return;
    }
    PioneerXDJR1.padLayer[deck] = PioneerXDJR1.padLayer[deck] === "hotcue" ? "key" : "hotcue";
    PioneerXDJR1.paintPads(0, group);
};

PioneerXDJR1.pad = function(channel, control, value, status, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    var shifted = PioneerXDJR1.padShiftNotes[control] !== undefined;
    var pad = shifted ? PioneerXDJR1.padShiftNotes[control] : PioneerXDJR1.padNotes[control];
    if (!pad) {
        return;
    }
    var pressed = PioneerXDJR1.isPress(value, status);
    if (PioneerXDJR1.padLayer[deck] === "key") {
        if (pressed) {
            var keyActions = {1: "pitch_up", 2: "pitch_down", 3: "sync_key", 4: "reset_key"};
            engine.setValue(group, keyActions[pad], 1);
        }
        return;
    }
    if (shifted) {
        if (pressed) {
            engine.setValue(group, "hotcue_" + pad + "_clear", 1);
        }
        return;
    }
    // Held: set or jump to the cue; releasing returns to the cue while paused.
    engine.setValue(group, "hotcue_" + pad + "_activate", pressed ? 1 : 0);
};

PioneerXDJR1.paintPads = function(_value, group) {
    var deck = PioneerXDJR1.deckNumber(group);
    if (deck < 1 || deck > 2) {
        return;
    }
    var status = PioneerXDJR1.deckStatus(deck);
    var lit = {};
    if (PioneerXDJR1.padLayer[deck] === "key") {
        var shift = engine.getValue(group, "pitch_adjust");
        lit = {1: shift > 0, 2: shift < 0, 3: true, 4: shift !== 0};
    } else {
        for (var cue = 1; cue <= 4; cue++) {
            lit[cue] = engine.getValue(group, "hotcue_" + cue + "_status") > 0;
        }
    }
    for (var note in PioneerXDJR1.padNotes) {
        midi.sendShortMsg(status, Number(note), lit[PioneerXDJR1.padNotes[note]] ? 0x7F : 0x00);
    }
    // MODE lamp: lit = HOT CUE, dark = KEY layer (manual, p. 29).
    midi.sendShortMsg(status, 0x3B, PioneerXDJR1.padLayer[deck] === "hotcue" ? 0x7F : 0x00);
};

// ---------------------------------------------------------------------------
// Beat FX: TRANS / FLANGER / ECHO / ROLL, BEAT, LEVEL/DEPTH
// ---------------------------------------------------------------------------

// Each deck has its own Beat FX chain: deck 1 on effect unit 3, deck 2 on
// unit 4, both loaded with the "XDJ-R1 BEAT FX" chain preset (position 1 of
// the chain preset list): TRANS (tremolo) in slot 1, FLANGER in slot 2, ECHO
// in slot 3. Any of them can run at once, on either deck.
// - FX button: turns its effect on and makes it the one being edited; the
//   edited button flashes. LEVEL/DEPTH and BEAT act on the edited effect.
// - SHIFT + FX button: turns that effect off.
// - ROLL: loop roll on the deck at the BEAT size (same on/off/edit rules).
// - SHIFT + TAP: effects process only the mids and highs; the lows stay dry
//   (patch 0049, [EffectRack1_EffectUnitN],rx3_keep_lows).
// The screen shows both decks' effects in two FX panes ([Skin],xdj_fx_*).
PioneerXDJR1.beatFx = [
    {name: "TRANS", slot: 1},
    {name: "SIDECHAIN", sidechain: true},
    {name: "ECHO", slot: 3},
    {name: "ROLL"},
];
PioneerXDJR1.beatFxFirstNote = 0x46; // SHIFT notes start at 0x62
PioneerXDJR1.beatFxPreset = 1;
PioneerXDJR1.beatValues = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];
PioneerXDJR1.defaultBeat = 5; // 1 beat
PioneerXDJR1.fxEdit = {1: -1, 2: -1}; // index into beatFx, -1 = none
PioneerXDJR1.fxBeat = {1: [5, 5, 5, 5], 2: [5, 5, 5, 5]}; // index into beatValues
PioneerXDJR1.fxLevel = {1: [0.5, 0.5, 0.5], 2: [0.5, 0.5, 0.5]}; // 0..1 per FX (shown 0..200%)
PioneerXDJR1.fxLevelSet = {1: [false, false, false], 2: [false, false, false]};
PioneerXDJR1.levelKnob = {1: 0.5, 2: 0.5};
PioneerXDJR1.unitReady = {1: false, 2: false};
PioneerXDJR1.rollOn = {1: false, 2: false};
PioneerXDJR1.rollSize = {1: 0, 2: 0};
PioneerXDJR1.blinkOn = true;
PioneerXDJR1.skinReady = false;

PioneerXDJR1.fxDeck = function(status) {
    return (status & 0x0F) === 4 ? 1 : 2;
};

PioneerXDJR1.fxUnit = function(deck) {
    return "[EffectRack1_EffectUnit" + (deck + 2) + "]";
};

PioneerXDJR1.fxSlot = function(deck, slot) {
    return "[EffectRack1_EffectUnit" + (deck + 2) + "_Effect" + slot + "]";
};

PioneerXDJR1.fxOn = function(deck, index) {
    var fx = PioneerXDJR1.beatFx[index];
    if (fx.name === "ROLL") {
        return PioneerXDJR1.rollOn[deck];
    }
    if (fx.sidechain) {
        return engine.getValue(PioneerXDJR1.fxUnit(deck), "rx3_sidechain_enabled") > 0;
    }
    return engine.getValue(PioneerXDJR1.fxSlot(deck, fx.slot), "enabled") > 0;
};

// Loads the deck's chain once and routes it to that deck only, at full wet:
// each effect's own level (its meta knob) sets how much of it you hear.
// If the effects were not ready yet when the mapping started, the chain is
// loaded again on the next FX button press.
PioneerXDJR1.prepareFxUnit = function(deck) {
    if (PioneerXDJR1.unitReady[deck] &&
        engine.getValue(PioneerXDJR1.fxSlot(deck, 1), "loaded") > 0) {
        return;
    }
    var unit = PioneerXDJR1.fxUnit(deck);
    engine.setValue(unit, "loaded_chain_preset", PioneerXDJR1.beatFxPreset);
    engine.setValue(unit, "mix", 1);
    engine.setValue(unit, "group_[Master]_enable", 0);
    engine.setValue(unit, "group_[Channel" + deck + "]_enable", 1);
    engine.setValue(unit, "group_[Channel" + (3 - deck) + "]_enable", 0);
    engine.setValue(unit, "enabled", 1);
    PioneerXDJR1.unitReady[deck] = true;
};

// [Skin] controls exist once the skin has loaded, which is after init.
PioneerXDJR1.skinSet = function(key, value) {
    if (PioneerXDJR1.skinReady) {
        engine.setValue("[Skin]", key, value);
    }
};

PioneerXDJR1.updateFxScreen = function(deck) {
    var edit = PioneerXDJR1.fxEdit[deck];
    PioneerXDJR1.skinSet("xdj_fx_panes", 1);
    PioneerXDJR1.skinSet("xdj_fx" + deck + "_edit", edit + 1);
    PioneerXDJR1.skinSet("xdj_fx" + deck + "_roll", PioneerXDJR1.rollOn[deck] ? 1 : 0);
    PioneerXDJR1.skinSet("xdj_fx" + deck + "_beat",
        edit >= 0 ? PioneerXDJR1.fxBeat[deck][edit] : PioneerXDJR1.defaultBeat);
    for (var i = 0; i < 4; i++) {
        PioneerXDJR1.skinSet("xdj_fx" + deck + "_beat" + (i + 1), PioneerXDJR1.fxBeat[deck][i]);
    }
    for (var j = 0; j < 3; j++) {
        PioneerXDJR1.skinSet("xdj_fx" + deck + "_level" + (j + 1),
            Math.round(PioneerXDJR1.fxLevel[deck][j] * 200));
    }
};

PioneerXDJR1.paintBeatFx = function(deck) {
    for (var index = 0; index < PioneerXDJR1.beatFx.length; index++) {
        var lit = PioneerXDJR1.fxOn(deck, index);
        if (lit && index === PioneerXDJR1.fxEdit[deck]) {
            lit = PioneerXDJR1.blinkOn;
        }
        midi.sendShortMsg(0x94 + deck - 1, PioneerXDJR1.beatFxFirstNote + index, lit ? 0x7F : 0x00);
    }
};

PioneerXDJR1.paintAllBeatFx = function() {
    PioneerXDJR1.paintBeatFx(1);
    PioneerXDJR1.paintBeatFx(2);
};

PioneerXDJR1.blinkBeatFx = function() {
    PioneerXDJR1.blinkOn = !PioneerXDJR1.blinkOn;
    for (var deck = 1; deck <= 2; deck++) {
        if (PioneerXDJR1.fxEdit[deck] >= 0) {
            PioneerXDJR1.paintBeatFx(deck);
        }
    }
};

PioneerXDJR1.initBeatFx = function() {
    for (var deck = 1; deck <= 2; deck++) {
        PioneerXDJR1.prepareFxUnit(deck);
        var unit = PioneerXDJR1.fxUnit(deck);
        engine.setValue(unit, "rx3_sidechain_enabled", 0);
        PioneerXDJR1.connect(unit, "rx3_sidechain_enabled", PioneerXDJR1.paintAllBeatFx);
        for (var slot = 1; slot <= 3; slot++) {
            engine.setValue(PioneerXDJR1.fxSlot(deck, slot), "enabled", 0);
            PioneerXDJR1.connect(PioneerXDJR1.fxSlot(deck, slot), "enabled",
                PioneerXDJR1.paintAllBeatFx);
        }
    }
    PioneerXDJR1.paintAllBeatFx();
    engine.beginTimer(250, PioneerXDJR1.blinkBeatFx);
    // Show the two FX panes once the skin is up.
    engine.beginTimer(3000, function() {
        PioneerXDJR1.skinReady = true;
        PioneerXDJR1.updateFxScreen(1);
        PioneerXDJR1.updateFxScreen(2);
    }, true);
};

PioneerXDJR1.setRoll = function(deck, beats) {
    var group = "[Channel" + deck + "]";
    if (PioneerXDJR1.rollSize[deck]) {
        engine.setValue(group, "beatlooproll_" + PioneerXDJR1.rollSize[deck] + "_activate", 0);
    }
    PioneerXDJR1.rollSize[deck] = beats;
    if (beats) {
        engine.setValue(group, "beatlooproll_" + beats + "_activate", 1);
    }
};

// Loop rolls have no 3/4 size; that step rolls 1/2 a beat.
PioneerXDJR1.rollBeatsFor = function(deck) {
    var beats = PioneerXDJR1.beatValues[PioneerXDJR1.fxBeat[deck][3]];
    return beats === 3 / 4 ? 1 / 2 : beats;
};

PioneerXDJR1.clamp = function(value, low, high) {
    return Math.max(low, Math.min(high, value));
};

// Applies an effect's beat time: TRANS = gate cycles per beat, FLANGER =
// sweep period in beats, ECHO = delay in beats.
PioneerXDJR1.applyFxBeat = function(deck, index) {
    var beats = PioneerXDJR1.beatValues[PioneerXDJR1.fxBeat[deck][index]];
    var fx = PioneerXDJR1.beatFx[index];
    if (fx.name === "ROLL") {
        if (PioneerXDJR1.rollOn[deck]) {
            PioneerXDJR1.setRoll(deck, PioneerXDJR1.rollBeatsFor(deck));
        }
        return;
    }
    if (fx.sidechain) {
        return;
    }
    var group = PioneerXDJR1.fxSlot(deck, fx.slot);
    if (fx.name === "TRANS") {
        engine.setValue(group, "parameter2", PioneerXDJR1.clamp(1 / beats, 1 / 4, 16));
    } else {
        engine.setValue(group, "parameter1", PioneerXDJR1.clamp(beats, 1 / 16, 4));
    }
};

// The first effect still on, or -1.
PioneerXDJR1.firstActiveFx = function(deck) {
    for (var index = 0; index < PioneerXDJR1.beatFx.length; index++) {
        if (PioneerXDJR1.fxOn(deck, index)) {
            return index;
        }
    }
    return -1;
};

PioneerXDJR1.beatFxButton = function(channel, control, value, status) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    var deck = PioneerXDJR1.fxDeck(status);
    var shifted = control >= 0x62;
    var index = (shifted ? control - 0x1C : control) - PioneerXDJR1.beatFxFirstNote;
    if (index < 0 || index >= PioneerXDJR1.beatFx.length) {
        return;
    }
    var fx = PioneerXDJR1.beatFx[index];
    PioneerXDJR1.prepareFxUnit(deck);
    if (shifted) {
        // SHIFT + button: this effect off.
        if (fx.name === "ROLL") {
            PioneerXDJR1.rollOn[deck] = false;
            PioneerXDJR1.setRoll(deck, 0);
        } else if (fx.sidechain) {
            engine.setValue(PioneerXDJR1.fxUnit(deck), "rx3_sidechain_enabled", 0);
        } else {
            engine.setValue(PioneerXDJR1.fxSlot(deck, fx.slot), "enabled", 0);
        }
        if (PioneerXDJR1.fxEdit[deck] === index) {
            PioneerXDJR1.fxEdit[deck] = PioneerXDJR1.firstActiveFx(deck);
        }
    } else {
        // Button: this effect on, and edited by LEVEL/DEPTH and BEAT.
        if (fx.name === "ROLL") {
            if (!PioneerXDJR1.rollOn[deck]) {
                PioneerXDJR1.rollOn[deck] = true;
                PioneerXDJR1.setRoll(deck, PioneerXDJR1.rollBeatsFor(deck));
            }
        } else if (fx.sidechain) {
            var unit = PioneerXDJR1.fxUnit(deck);
            if (!PioneerXDJR1.fxLevelSet[deck][index]) {
                PioneerXDJR1.fxLevel[deck][index] = PioneerXDJR1.levelKnob[deck];
                engine.setValue(unit, "rx3_sidechain_depth", PioneerXDJR1.levelKnob[deck]);
                PioneerXDJR1.fxLevelSet[deck][index] = true;
            }
            engine.setValue(unit, "rx3_sidechain_enabled", 1);
        } else {
            var group = PioneerXDJR1.fxSlot(deck, fx.slot);
            if (!PioneerXDJR1.fxLevelSet[deck][index]) {
                PioneerXDJR1.fxLevel[deck][index] = PioneerXDJR1.levelKnob[deck];
                engine.setValue(group, "meta", PioneerXDJR1.levelKnob[deck]);
                PioneerXDJR1.fxLevelSet[deck][index] = true;
            }
            PioneerXDJR1.applyFxBeat(deck, index);
            engine.setValue(group, "enabled", 1);
        }
        PioneerXDJR1.fxEdit[deck] = index;
        PioneerXDJR1.blinkOn = true;
    }
    PioneerXDJR1.paintBeatFx(deck);
    PioneerXDJR1.skinReady = true;
    PioneerXDJR1.updateFxScreen(deck);
};

// BEAT knob (B4/B5 0x00; SHIFT 0x10), absolute 0-127: beat time of the
// edited effect.
PioneerXDJR1.beatFxBeat = function(channel, control, value, status) {
    var deck = PioneerXDJR1.fxDeck(status);
    var steps = PioneerXDJR1.beatValues.length;
    var step = Math.min(steps - 1, Math.floor(value / 128 * steps));
    var edit = PioneerXDJR1.fxEdit[deck];
    if (edit < 0) {
        PioneerXDJR1.defaultBeat = step;
        for (var index = 0; index < PioneerXDJR1.beatFx.length; index++) {
            if (!PioneerXDJR1.fxOn(deck, index)) {
                PioneerXDJR1.fxBeat[deck][index] = step;
            }
        }
    } else {
        PioneerXDJR1.fxBeat[deck][edit] = step;
        PioneerXDJR1.applyFxBeat(deck, edit);
    }
    PioneerXDJR1.updateFxScreen(deck);
};

// LEVEL/DEPTH (B4/B5 0x02 + 0x22, 14-bit): level of the edited effect (echo
// send, flanger mix, tremolo depth: each effect's meta knob).
PioneerXDJR1.applyBeatFxLevel = function(deck, normalized) {
    PioneerXDJR1.levelKnob[deck] = normalized;
    var edit = PioneerXDJR1.fxEdit[deck];
    if (edit < 0) {
        return;
    }
    var fx = PioneerXDJR1.beatFx[edit];
    if (fx.sidechain) {
        PioneerXDJR1.fxLevel[deck][edit] = normalized;
        engine.setValue(PioneerXDJR1.fxUnit(deck), "rx3_sidechain_depth", normalized);
        PioneerXDJR1.fxLevelSet[deck][edit] = true;
        PioneerXDJR1.updateFxScreen(deck);
        return;
    }
    if (!fx.slot) {
        return;
    }
    PioneerXDJR1.fxLevel[deck][edit] = normalized;
    engine.setValue(PioneerXDJR1.fxSlot(deck, fx.slot), "meta", normalized);
    PioneerXDJR1.fxLevelSet[deck][edit] = true;
    PioneerXDJR1.updateFxScreen(deck);
};

PioneerXDJR1.beatFxLevelMsb = function(channel, control, value, status) {
    var deck = PioneerXDJR1.fxDeck(status);
    PioneerXDJR1.applyBeatFxLevel(deck,
        PioneerXDJR1.fourteenBitValue("fxlevel" + deck, "msb", value));
};

PioneerXDJR1.beatFxLevelLsb = function(channel, control, value, status) {
    var deck = PioneerXDJR1.fxDeck(status);
    PioneerXDJR1.applyBeatFxLevel(deck,
        PioneerXDJR1.fourteenBitValue("fxlevel" + deck, "lsb", value));
};

// SHIFT + TAP (94/95 0x74): mids-and-highs only, per deck.
PioneerXDJR1.keepLowsButton = function(channel, control, value, status) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    var deck = PioneerXDJR1.fxDeck(status);
    var unit = PioneerXDJR1.fxUnit(deck);
    var on = engine.getValue(unit, "rx3_keep_lows") > 0;
    engine.setValue(unit, "rx3_keep_lows", on ? 0 : 1);
    midi.sendShortMsg(0x94 + deck - 1, 0x58, on ? 0x00 : 0x7F);
    PioneerXDJR1.skinReady = true;
    PioneerXDJR1.updateFxScreen(deck);
};

PioneerXDJR1.stopBeatFx = function(deck) {
    PioneerXDJR1.rollOn[deck] = false;
    PioneerXDJR1.setRoll(deck, 0);
    engine.setValue(PioneerXDJR1.fxUnit(deck), "rx3_sidechain_enabled", 0);
    for (var slot = 1; slot <= 3; slot++) {
        engine.setValue(PioneerXDJR1.fxSlot(deck, slot), "enabled", 0);
    }
    PioneerXDJR1.fxEdit[deck] = -1;
    for (var index = 0; index < PioneerXDJR1.beatFx.length; index++) {
        midi.sendShortMsg(0x94 + deck - 1, PioneerXDJR1.beatFxFirstNote + index, 0x00);
    }
};

// ---------------------------------------------------------------------------
// SOUND COLOR FX + COLOR knob
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
    if (!PioneerXDJR1.isPress(value, status)) {
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
// Browser: SELECT press loads from the track list, otherwise navigates
// ---------------------------------------------------------------------------

// [Library] focused_widget is 3 while the track table has keyboard focus,
// which is where the NauticMixxx browser puts it on the track list.
PioneerXDJR1.trackListFocused = function() {
    return NauticRX3Browser.isOpen() && engine.getValue("[Library]", "focused_widget") === 3;
};

// SELECT turn: in PERFORMANCE it zooms both waveforms (right = in, left =
// out), like the skin's ZOOM buttons. With BROWSE, INFO or SHORTCUT open,
// in grid editing, or while SELECT is held, it keeps its browser job.
PioneerXDJR1.selectTurn = function(channel, control, value, status, group) {
    var delta = PioneerXDJR1.encoderDelta(value);
    if (delta === 0) {
        return;
    }
    if (NauticRX3Browser.isOpen() || NauticRX3Encoder.pressed ||
            engine.getValue("[RX3Info]", "visible") > 0 ||
            engine.getValue("[RX3Shortcut]", "visible") > 0 ||
            engine.getValue("[RX3Controller]", "grid_mode") > 0) {
        NauticRX3Browser.turn(channel, control, value, status, group);
        return;
    }
    // Mixxx names these by zoom level: "down" zooms in, "up" zooms out.
    var key = delta > 0 ? "waveform_zoom_down" : "waveform_zoom_up";
    for (var deck = 1; deck <= 2; deck++) {
        engine.setValue("[Channel" + deck + "]", key, 1);
        engine.setValue("[Channel" + deck + "]", key, 0);
    }
};

PioneerXDJR1.selectLoading = {};

PioneerXDJR1.selectPress = function(channel, control, value, status, group) {
    if (PioneerXDJR1.isPress(value, status)) {
        if (PioneerXDJR1.trackListFocused()) {
            PioneerXDJR1.selectLoading[group] = true;
            engine.setValue(group, "LoadSelectedTrack", 1);
            return;
        }
        PioneerXDJR1.selectLoading[group] = false;
    } else if (PioneerXDJR1.selectLoading[group]) {
        PioneerXDJR1.selectLoading[group] = false;
        return; // release of a load press
    }
    NauticRX3Browser.enter(channel, control, value, status, group);
};

// ---------------------------------------------------------------------------
// Transport and mixer buttons
// ---------------------------------------------------------------------------

PioneerXDJR1.ClearCue = function(channel, control, value, status, group) {
    if (PioneerXDJR1.isPress(value, status)) {
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

// PLAY/PAUSE acts on press. Pressed while CUE is held (cue preview), the
// deck keeps playing after CUE is released, as on a CDJ.
PioneerXDJR1.PlayDecks = function(channel, control, value, status, group) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    engine.setValue(group, "play", engine.getValue(group, "play") > 0 ? 0 : 1);
};

// CUE follows Mixxx's CDJ cue behaviour: while playing, return to the cue
// point and pause; while paused away from it, set it there; while paused on
// it, play for as long as CUE is held.
PioneerXDJR1.CueDecks = function(channel, control, value, status, group) {
    var pressed = PioneerXDJR1.isPress(value, status);
    if (pressed && engine.getValue(group, "cue_point") === -1 &&
            engine.getValue(group, "track_loaded") > 0) {
        // No cue point yet (or SHIFT + CUE cleared it): set one here.
        engine.setValue(group, "cue_set", 1);
        engine.setValue(group, "cue_set", 0);
        return;
    }
    engine.setValue(group, "cue_default", pressed ? 1 : 0);
};

PioneerXDJR1.paintPlay = function(value, group) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x0B,
        value > 0 ? 0x7F : 0x00);
};

PioneerXDJR1.paintCue = function(value, group) {
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x0C,
        value > 0 ? 0x7F : 0x00);
};

// SHIFT + MASTER TEMPO (0x56): quantize on/off for both decks. The MASTER
// TEMPO lamp keeps showing keylock, so nothing is sent to the unit here.
PioneerXDJR1.quantizeButton = function(channel, control, value, status) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    var enabled = engine.getValue("[Channel1]", "quantize") > 0 ||
        engine.getValue("[Channel2]", "quantize") > 0 ? 0 : 1;
    engine.setValue("[Channel1]", "quantize", enabled);
    engine.setValue("[Channel2]", "quantize", enabled);
};

// TIME (0x3E) in BROWSE: MATCH. Shows only the tracks of the list on screen
// that mix with the master deck (compatible key, tempo within 16%). Press
// again for the whole list.
PioneerXDJR1.matchButton = function(channel, control, value, status) {
    if (!PioneerXDJR1.isPress(value, status) || !NauticRX3Browser.isOpen()) {
        return;
    }
    engine.setValue("[RX3Browser]", "match_master", 1);
    engine.setValue("[RX3Browser]", "match_master", 0);
};

// SHIFT + SYNC (0x5C): open BROWSE if needed and toggle the MENU (UTILITY) page.
PioneerXDJR1.menuButton = function(channel, control, value, status) {
    if (!PioneerXDJR1.isPress(value, status)) {
        return;
    }
    if (!NauticRX3Browser.isOpen()) {
        NauticRX3Browser.open();
    }
    engine.setValue("[RX3Browser]", "utility", 1);
    engine.setValue("[RX3Browser]", "utility", 0);
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
    midi.sendShortMsg(PioneerXDJR1.deckStatus(PioneerXDJR1.deckNumber(group)), 0x1A,
        enabled ? 0x7F : 0x00);
};
