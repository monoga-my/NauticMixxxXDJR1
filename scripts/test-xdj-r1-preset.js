// Software checks for the Pioneer XDJ-R1 NauticMixxx preset.
// node scripts/test-xdj-r1-preset.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const folder = path.join(root, "controllers", "Pioneer_XDJ_R1_RX3");
const scriptPath = path.join(folder, "Pioneer-XDJ-R1-RX3-scripts.js");
const xmlPath = path.join(folder, "Pioneer-XDJ-R1-RX3.midi.xml");

const sharedFolder = path.join(root, "controllers", "Pioneer_Roland_RX3");

function load() {
    const values = new Map();
    const midiCalls = [];
    const connections = [];
    const scratch = [];
    const engine = {
        setValue(group, key, value) {
            values.set(`${group},${key}`, value);
            for (const c of connections) {
                if (c.group === group && c.key === key) c.callback(value, group, key);
            }
        },
        getValue(group, key) { return values.get(`${group},${key}`) || 0; },
        softTakeover() {},
        softTakeoverIgnoreNextValue() {},
        makeConnection(group, key, callback) {
            const connection = {group, key, callback,
                trigger() { callback(engine.getValue(group, key), group, key); },
                disconnect() {}};
            connections.push(connection);
            return connection;
        },
        beginTimer() { return 1; },
        stopTimer() {},
        scratchEnable(deck, ...args) { scratch.push(["enable", deck, ...args]); values.set(`scratch${deck}`, 1); },
        scratchDisable(deck, ramp) { scratch.push(["disable", deck, ramp]); values.set(`scratch${deck}`, 0); },
        scratchTick(deck, delta) { scratch.push(["tick", deck, delta]); },
        isScratching(deck) { return !!values.get(`scratch${deck}`); },
    };
    const sandbox = {
        console, engine, Date,
        midi: {sendShortMsg(status, control, value) { midiCalls.push([status, control, value]); }},
    };
    vm.createContext(sandbox);
    for (const file of [path.join(sharedFolder, "Nautic-RX3-Encoder-Pioneer-Roland.js"),
        path.join(sharedFolder, "Nautic-RX3-Browser.js"), scriptPath]) {
        vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, {filename: file});
    }
    const mapping = vm.runInContext("PioneerXDJR1", sandbox);
    const browser = vm.runInContext("NauticRX3Browser", sandbox);
    return {mapping, browser, values, midiCalls, scratch};
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-3,
    `${actual} != ${expected}`);

// TEMPO: 0 at "-" means slower, whatever rate_dir is.
for (const rateDir of [1, -1]) {
    const {mapping, values} = load();
    values.set("[Channel1],rate_dir", rateDir);
    mapping.tempoMsb(0, 0x00, 0x00, 0xB0, "[Channel1]");
    mapping.tempoLsb(0, 0x20, 0x00, 0xB0, "[Channel1]");
    close(values.get("[Channel1],rate") * rateDir, -1);
    mapping.tempoMsb(0, 0x00, 0x7F, 0xB0, "[Channel1]");
    mapping.tempoLsb(0, 0x20, 0x7F, 0xB0, "[Channel1]");
    close(values.get("[Channel1],rate") * rateDir, 1);
    mapping.tempoMsb(0, 0x00, 0x40, 0xB0, "[Channel1]");
    mapping.tempoLsb(0, 0x20, 0x00, 0xB0, "[Channel1]");
    close(values.get("[Channel1],rate") * rateDir, (0x2000 / 16383) * 2 - 1);
}

// TEMPO RANGE: each note selects its range; repeating the active one cycles.
{
    const {mapping, values, midiCalls} = load();
    values.set("[Channel2],rateRange", 0.06);
    mapping.tempoRange(1, 0x10, 0x7F, 0x91, "[Channel2]");
    close(values.get("[Channel2],rateRange"), 0.16);
    mapping.tempoRange(1, 0x11, 0x7F, 0x91, "[Channel2]");
    close(values.get("[Channel2],rateRange"), 1.0);
    mapping.tempoRange(1, 0x11, 0x7F, 0x91, "[Channel2]");
    close(values.get("[Channel2],rateRange"), 0.06);
    mapping.tempoRange(1, 0x57, 0x7F, 0x91, "[Channel2]");
    close(values.get("[Channel2],rateRange"), 0.10);
    mapping.tempoRange(1, 0x0E, 0x00, 0x91, "[Channel2]");
    close(values.get("[Channel2],rateRange"), 0.10);
    mapping.paintTempoRange(0.10, "[Channel2]");
    assert.deepEqual(midiCalls.slice(-4),
        [[0x91, 0x0E, 0], [0x91, 0x0F, 0x7F], [0x91, 0x10, 0], [0x91, 0x11, 0]]);
}

// SOUND COLOR FX + COLOR.
{
    const {mapping, values} = load();
    mapping.init();
    assert.equal(values.get("[QuickEffectRack1_[Channel1]],enabled"), 0);

    // COLOR with nothing selected only remembers the position.
    mapping.colorMsb(6, 0x1B, 0x7F);
    assert.equal(values.has("[QuickEffectRack1_[Channel1]],super1"), false);

    mapping.soundColorFxButton(4, 0x4E, 0x7F, 0x94); // FILTER
    for (const deck of [1, 2]) {
        const group = `[QuickEffectRack1_[Channel${deck}]]`;
        assert.equal(values.get(`${group},loaded_chain_preset`), 4);
        assert.equal(values.get(`${group},enabled`), 1);
    }
    close(values.get("[QuickEffectRack1_[Channel1]],super1"), 127 * 128 / 16383);
    close(values.get("[QuickEffectRack1_[Channel2]],super1"), 0.5);

    mapping.colorMsb(6, 0x1C, 0x00);
    mapping.colorLsb(6, 0x3C, 0x00);
    close(values.get("[QuickEffectRack1_[Channel2]],super1"), 0);

    mapping.soundColorFxButton(4, 0x6C, 0x7F, 0x94); // SHIFT + CRUSH
    assert.equal(values.get("[QuickEffectRack1_[Channel1]],loaded_chain_preset"), 6);
    close(values.get("[QuickEffectRack1_[Channel2]],super1"), 1); // centred amount

    mapping.soundColorFxButton(4, 0x4F, 0x7F, 0x94); // PITCH
    assert.equal(values.get("[QuickEffectRack1_[Channel1]],loaded_chain_preset"), 5);
    mapping.soundColorFxButton(4, 0x51, 0x7F, 0x94); // NOISE
    assert.equal(values.get("[QuickEffectRack1_[Channel1]],loaded_chain_preset"), 3);

    mapping.soundColorFxButton(4, 0x51, 0x7F, 0x94); // NOISE again = off
    assert.equal(mapping.soundColorFxSelected, 0);
    assert.equal(values.get("[QuickEffectRack1_[Channel1]],enabled"), 0);
    assert.equal(values.get("[QuickEffectRack1_[Channel2]],enabled"), 0);
}

// SELECT press: loads into that deck from the focused track list, else enters.
{
    const {mapping, browser, values} = load();
    let entered = 0;
    browser.enter = () => { entered++; };
    values.set("[Tab],current", 1); // browser open
    values.set("[Library],focused_widget", 3); // track list
    mapping.selectPress(0, 0x42, 0x7F, 0x91, "[Channel2]");
    mapping.selectPress(0, 0x42, 0x00, 0x91, "[Channel2]");
    assert.equal(values.get("[Channel2],LoadSelectedTrack"), 1);
    assert.equal(entered, 0, "a load press never navigates");
    values.set("[Library],focused_widget", 2); // folder tree
    mapping.selectPress(0, 0x42, 0x7F, 0x90, "[Channel1]");
    mapping.selectPress(0, 0x42, 0x00, 0x90, "[Channel1]");
    assert.equal(values.has("[Channel1],LoadSelectedTrack"), false);
    assert.equal(entered, 2, "press and release go to the browser");
}

// SELECT turn: zooms both waveforms in PERFORMANCE, browses otherwise.
{
    const {mapping, browser, values} = load();
    const zooms = [];
    let turned = 0;
    browser.turn = () => { turned++; };
    const realSet = Object.getPrototypeOf(values).set;
    values.set = function(key, value) {
        if (/waveform_zoom_(up|down)$/.test(key) && value === 1) zooms.push(key);
        return realSet.call(this, key, value);
    };
    mapping.selectTurn(0, 0x40, 0x01, 0xB0, "[Library]"); // right
    assert.deepEqual(zooms, ["[Channel1],waveform_zoom_down", "[Channel2],waveform_zoom_down"],
        "right zooms both decks in");
    mapping.selectTurn(0, 0x40, 0x7F, 0xB1, "[Library]"); // left
    assert.deepEqual(zooms.slice(2), ["[Channel1],waveform_zoom_up", "[Channel2],waveform_zoom_up"]);
    assert.equal(turned, 0);
    for (const [key, value] of [["[Tab],current", 1], ["[RX3Info],visible", 1],
        ["[RX3Shortcut],visible", 1], ["[RX3Controller],grid_mode", 1]]) {
        values.set(key, value);
        mapping.selectTurn(0, 0x40, 0x01, 0xB0, "[Library]");
        values.set(key, 0);
    }
    assert.equal(turned, 4, "browser, INFO, SHORTCUT and grid keep the knob");
    assert.equal(zooms.length, 4);
}

// AUTO BEAT LOOP: press loops at the deck's size or exits; turn halves/doubles.
{
    const {mapping, values, midiCalls} = load();
    mapping.init();
    mapping.autoLoopPress(0, 0x14, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],beatloop_activate"), 1);
    values.set("[Channel1],loop_enabled", 1);
    mapping.autoLoopPress(0, 0x14, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],reloop_toggle"), 1);
    mapping.autoLoopTurn(0, 0x13, 0x01, 0xB0, "[Channel1]");
    assert.equal(values.get("[Channel1],loop_double"), 1);
    mapping.autoLoopTurn(0, 0x13, 0x7F, 0xB0, "[Channel1]");
    assert.equal(values.get("[Channel1],loop_halve"), 1);
    engine_set(values, mapping, "[Channel1]", "beatloop_size", 4);
    mapping.paintLoopSize(4, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x71, 0x7F], "4 beats shown on the unit");
    mapping.paintLoop(1, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x14, 0x7F]);
}
function engine_set(values, _mapping, group, key, value) { values.set(`${group},${key}`, value); }

// SYNC / MASTER: persistent sync with phase alignment, lights follow the engine.
{
    const {mapping, values, midiCalls} = load();
    mapping.init();
    mapping.Sync(0, 0x58, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],sync_enabled"), 1);
    assert.equal(values.get("[Channel1],beatsync_phase"), 1);
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x58, 0x7F]);
    mapping.Sync(0, 0x58, 0x00, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],sync_enabled"), 1, "release does nothing");
    mapping.Sync(0, 0x58, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],sync_enabled"), 0);
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x58, 0x00]);
    mapping.Master(0, 0x59, 0x7F, 0x91, "[Channel2]");
    assert.equal(values.get("[Channel2],sync_leader"), 1);
    assert.deepEqual(midiCalls.at(-1), [0x91, 0x59, 0x7F]);
    values.set("[Channel1],rx3_source_lost", 1);
    mapping.Sync(0, 0x58, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],sync_enabled"), 0, "a lost USB deck cannot rejoin SYNC");
}

// Channel level meters go to B6 0x47 / 0x48.
{
    const {mapping, midiCalls} = load();
    mapping.paintVuMeter(1, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0xB6, 0x47, 127]);
    mapping.paintVuMeter(0.5, "[Channel2]");
    assert.deepEqual(midiCalls.at(-1), [0xB6, 0x48, 64]);
}

// Hot cues A-D; MODE switches to the KEY layer.
{
    const {mapping, values, midiCalls} = load();
    mapping.init();
    mapping.pad(0, 0x2E, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],hotcue_1_activate"), 1);
    mapping.pad(0, 0x2E, 0x00, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],hotcue_1_activate"), 0);
    mapping.pad(0, 0x19, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],hotcue_4_activate"), 1, "CALL is hot cue D");
    mapping.pad(0, 0x34, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],hotcue_3_activate"), 1, "sampler-mode notes are hot cues too");
    mapping.pad(0, 0x60, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],hotcue_2_clear"), 1, "SHIFT deletes");
    values.set("[Channel1],hotcue_2_status", 1);
    mapping.paintPads(0, "[Channel1]");
    assert.ok(midiCalls.some(c => c[0] === 0x90 && c[1] === 0x2F && c[2] === 0x7F), "set cue lit");

    mapping.modeButton(0, 0x3B, 0x7F, 0x90, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x3B, 0x00], "MODE lamp dark in KEY layer");
    for (const [note, key] of [[0x2E, "pitch_up"], [0x2F, "pitch_down"], [0x30, "sync_key"],
        [0x19, "reset_key"]]) {
        mapping.pad(0, note, 0x7F, 0x90, "[Channel1]");
        assert.equal(values.get(`[Channel1],${key}`), 1, key);
    }
    assert.equal(values.has("[Channel2],pitch_up"), false, "other deck untouched");
    mapping.modeButton(0, 0x3B, 0x7F, 0x90, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x3B, 0x7F]);
}

// MODE: the unit sends its HOT CUE / SAMPLER state, 0x7F then 0x00 on the
// next press. A 0x00 long after the 0x7F toggles back; a quick release does not.
{
    const {mapping, midiCalls} = load();
    mapping.init();
    const realNow = Date.now;
    let now = 1000000;
    Date.now = () => now;
    try {
        mapping.modeButton(0, 0x3B, 0x7F, 0x90, "[Channel1]");
        assert.equal(mapping.padLayer[1], "key");
        now += 1500; // the next press, sent as 0x00
        mapping.modeButton(0, 0x3B, 0x00, 0x90, "[Channel1]");
        assert.equal(mapping.padLayer[1], "hotcue", "second press returns to hot cues");
        assert.deepEqual(midiCalls.at(-1), [0x90, 0x3B, 0x7F]);
        now += 1500;
        mapping.modeButton(0, 0x3B, 0x7F, 0x90, "[Channel1]");
        now += 120; // a plain release right after the press
        mapping.modeButton(0, 0x3B, 0x00, 0x90, "[Channel1]");
        assert.equal(mapping.padLayer[1], "key", "a quick release is ignored");
    } finally {
        Date.now = realNow;
    }
}

// VINYL: touch the top to scratch; CDJ mode bends with the whole platter.
{
    const {mapping, values, scratch, midiCalls} = load();
    mapping.init();
    mapping.platterTouch(0, 0x36, 0x7F, 0x90, "[Channel1]");
    assert.equal(scratch.at(-1)[0], "enable");
    assert.equal(scratch.at(-1)[2], 600, "600 ticks per turn");
    mapping.jogTop(0, 0x02, 0x3C, 0xB0, "[Channel1]");
    assert.deepEqual(scratch.at(-1), ["tick", 1, -4]);
    mapping.platterTouch(0, 0x36, 0x00, 0x90, "[Channel1]");
    assert.deepEqual(scratch.at(-1), ["disable", 1, true]);
    mapping.jog_wheel(0, 0x01, 0x49, 0xB0, "[Channel1]");
    close(values.get("[Channel1],jog"), 1);

    mapping.vinylButton(0, 0x15, 0x7F, 0x90, "[Channel1]");
    assert.deepEqual(midiCalls.at(-1), [0x90, 0x15, 0x00], "VINYL lamp off");
    const before = scratch.length;
    mapping.platterTouch(0, 0x36, 0x7F, 0x90, "[Channel1]");
    mapping.jogTop(0, 0x02, 0x52, 0xB0, "[Channel1]");
    assert.equal(scratch.length, before, "CDJ mode never scratches");
    close(values.get("[Channel1],jog"), 2);
}

// Beat FX: each deck has its own chain (unit 3 / unit 4); several effects at
// once, the last pressed is edited (flashing), SHIFT + button turns one off.
{
    const {mapping, values, midiCalls} = load();
    mapping.init();
    const u3 = "[EffectRack1_EffectUnit3]", u4 = "[EffectRack1_EffectUnit4]";
    const s = (unit, slot) => `[EffectRack1_EffectUnit${unit}_Effect${slot}]`;
    assert.equal(values.get(`${u3},loaded_chain_preset`), 1, "XDJ-R1 BEAT FX chain on deck 1");
    assert.equal(values.get(`${u4},loaded_chain_preset`), 1, "and on deck 2");
    assert.equal(values.get(`${u3},group_[Channel1]_enable`), 1);
    assert.equal(values.get(`${u3},group_[Channel2]_enable`), 0);
    assert.equal(values.get(`${u4},group_[Channel2]_enable`), 1);
    assert.equal(values.get(`${u3},mix`), 1);
    assert.equal(values.get(`${u3},enabled`), 1);

    mapping.beatFxLevelMsb(0, 0x02, 0x40, 0xB4); // LEVEL before any effect
    mapping.beatFxButton(0, 0x46, 0x7F, 0x94); // TRANS on deck 1
    mapping.beatFxButton(0, 0x48, 0x7F, 0x94); // ECHO on deck 1 as well
    assert.equal(values.get(`${s(3, 1)},enabled`), 1, "TRANS on");
    assert.equal(values.get(`${s(3, 3)},enabled`), 1, "ECHO on at the same time");
    assert.equal(mapping.fxEdit[1], 2, "ECHO is edited");
    close(values.get(`${s(3, 1)},meta`), 0x40 * 128 / 16383); // first level = knob
    // LEVEL/DEPTH now changes ECHO only.
    mapping.beatFxLevelMsb(0, 0x02, 0x7F, 0xB4);
    close(values.get(`${s(3, 3)},meta`), 0x7F * 128 / 16383);
    close(values.get(`${s(3, 1)},meta`), 0x40 * 128 / 16383);
    // BEAT: 1/2 beat on ECHO = 0.5 beat delay.
    mapping.beatFxBeat(0, 0x00, 40, 0xB4);
    assert.equal(values.get(`${s(3, 3)},parameter1`), 0.5);
    // Press TRANS again: it becomes the edited one; BEAT 1/4 = 4 gate cycles per beat.
    mapping.beatFxButton(0, 0x46, 0x7F, 0x94);
    assert.equal(mapping.fxEdit[1], 0);
    mapping.beatFxBeat(0, 0x00, 26, 0xB4);
    assert.equal(values.get(`${s(3, 1)},parameter2`), 4);
    // The edited button flashes; the other lit one stays lit.
    midiCalls.length = 0;
    mapping.blinkBeatFx();
    const trans = midiCalls.filter((m) => m[0] === 0x94 && m[1] === 0x46).pop();
    const echo = midiCalls.filter((m) => m[0] === 0x94 && m[1] === 0x48).pop();
    assert.equal(trans[2], 0x00, "edited TRANS flashes");
    assert.equal(echo[2], 0x7F, "ECHO stays lit");
    // Deck 2 runs its own FLANGER at the same time.
    mapping.beatFxButton(0, 0x47, 0x7F, 0x95);
    assert.equal(values.get(`${s(4, 2)},enabled`), 1);
    assert.equal(values.get(`${s(3, 1)},enabled`), 1, "deck 1 effects untouched");
    // SHIFT + TRANS turns TRANS off; editing moves to the effect still on.
    mapping.beatFxButton(0, 0x62, 0x7F, 0x94);
    assert.equal(values.get(`${s(3, 1)},enabled`), 0);
    assert.equal(values.get(`${s(3, 3)},enabled`), 1);
    assert.equal(mapping.fxEdit[1], 2);
    // SHIFT + TAP: mids and highs only on deck 1.
    mapping.keepLowsButton(0, 0x74, 0x7F, 0x94);
    assert.equal(values.get(`${u3},rx3_keep_lows`), 1);
    assert.equal(values.get(`${u4},rx3_keep_lows`) || 0, 0);
    mapping.keepLowsButton(0, 0x74, 0x7F, 0x94);
    assert.equal(values.get(`${u3},rx3_keep_lows`), 0);
    // The screen panes follow: deck 1 editing ECHO (3), deck 2 FLANGER (2).
    assert.equal(values.get("[Skin],xdj_fx_panes"), 1);
    assert.equal(values.get("[Skin],xdj_fx1_edit"), 3);
    assert.equal(values.get("[Skin],xdj_fx2_edit"), 2);
    // ROLL: loop roll at its BEAT size; SHIFT + ROLL stops it.
    mapping.beatFxButton(0, 0x49, 0x7F, 0x94);
    mapping.beatFxBeat(0, 0x00, 0x00, 0xB4); // 1/16 beat
    assert.equal(values.get(`[Channel1],beatlooproll_${1 / 16}_activate`), 1);
    mapping.beatFxButton(0, 0x65, 0x7F, 0x94);
    assert.equal(values.get(`[Channel1],beatlooproll_${1 / 16}_activate`), 0);
    assert.equal(mapping.rollOn[1], false);
}

// PLAY acts on press; during a cue preview it latches play (CDJ behaviour).
{
    const {mapping, values} = load();
    values.set("[Channel1],track_loaded", 1);
    values.set("[Channel1],cue_point", 1000);
    mapping.CueDecks(0, 0x0C, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],cue_default"), 1);
    values.set("[Channel1],play", 1); // the engine plays the cue preview
    mapping.PlayDecks(0, 0x0B, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],play"), 0, "toggle request latches play in Mixxx");
    mapping.PlayDecks(0, 0x0B, 0x00, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],play"), 0, "release does nothing");
    mapping.CueDecks(0, 0x0C, 0x00, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],cue_default"), 0);
    // No cue point: CUE sets one instead of doing nothing.
    values.set("[Channel1],cue_point", -1);
    mapping.CueDecks(0, 0x0C, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],cue_set"), 0);
    assert.equal(values.get("[Channel1],cue_default"), 0);
}

// SHIFT + MASTER TEMPO toggles quantize on both decks and sends no light.
{
    const {mapping, values, midiCalls} = load();
    values.set("[Channel1],keylock", 1);
    values.set("[Channel1],quantize", 1);
    values.set("[Channel2],quantize", 1);
    midiCalls.length = 0;
    mapping.quantizeButton(0, 0x56, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],quantize"), 0);
    assert.equal(values.get("[Channel2],quantize"), 0);
    mapping.quantizeButton(0, 0x56, 0x00, 0x90, "[Channel1]");
    mapping.quantizeButton(0, 0x56, 0x7F, 0x90, "[Channel1]");
    assert.equal(values.get("[Channel1],quantize"), 1);
    assert.equal(midiCalls.length, 0, "MASTER TEMPO lamp untouched");
    assert.equal(values.get("[Channel1],keylock"), 1);
}

// TIME in BROWSE pulses the MATCH filter.
{
    const {mapping, browser, values} = load();
    const seen = [];
    const engineSet = values.set.bind(values);
    values.set = (k, v) => { if (k === "[RX3Browser],match_master") seen.push(v); return engineSet(k, v); };
    browser.isOpen = () => false;
    mapping.matchButton(0, 0x3E, 0x7F, 0x90);
    assert.deepEqual(seen, []);
    browser.isOpen = () => true;
    mapping.matchButton(0, 0x3E, 0x7F, 0x90);
    assert.deepEqual(seen, [1, 0]);
}

// XML: every script binding exists, and the addresses come from the manual.
{
    const xml = fs.readFileSync(xmlPath, "utf8");
    const {mapping} = load();
    const browser = fs.readFileSync(path.join(root, "controllers", "Pioneer_Roland_RX3",
        "Nautic-RX3-Browser.js"), "utf8");
    for (const [, key] of xml.matchAll(/<key>([A-Za-z0-9]+\.[A-Za-z_]+)<\/key>/g)) {
        const [prefix, name] = key.split(".");
        if (prefix === "PioneerXDJR1") {
            assert.equal(typeof mapping[name], "function", key);
        } else {
            assert.equal(prefix, "NauticRX3Browser", key);
            assert.ok(browser.includes(`NauticRX3Browser.${name} =`), key);
        }
    }
    for (const file of xml.matchAll(/filename="([^"]+)"/g)) {
        const local = path.join(folder, file[1]);
        const shared = path.join(root, "controllers", "Pioneer_Roland_RX3", file[1]);
        assert.ok(fs.existsSync(local) || fs.existsSync(shared), file[1]);
    }
    const has = (status, midino, key) => assert.ok(new RegExp(
        `<key>${key.replace(".", "\\.")}</key>\\s*<status>${status}</status>\\s*<midino>${midino}</midino>`)
        .test(xml), `${status}/${midino} ${key}`);
    has("0xB0", "0x00", "PioneerXDJR1.tempoMsb");
    has("0xB1", "0x20", "PioneerXDJR1.tempoLsb");
    for (const note of ["0x0E", "0x0F", "0x10", "0x11"]) has("0x90", note, "PioneerXDJR1.tempoRange");
    for (const note of ["0x4E", "0x4F", "0x50", "0x51", "0x6A", "0x6D"]) {
        has("0x94", note, "PioneerXDJR1.soundColorFxButton");
    }
    has("0xB6", "0x1B", "PioneerXDJR1.colorMsb");
    has("0xB6", "0x1C", "PioneerXDJR1.colorMsb");
    assert.equal(xml.includes("<key>rate</key>"), false, "the reversed 7-bit rate binding is gone");
    has("0x90", "0x14", "PioneerXDJR1.autoLoopPress");
    has("0xB1", "0x13", "PioneerXDJR1.autoLoopTurn");
    has("0x91", "0x59", "PioneerXDJR1.Master");
    has("0x90", "0x15", "PioneerXDJR1.vinylButton");
    has("0x90", "0x36", "PioneerXDJR1.platterTouch");
    has("0xB0", "0x02", "PioneerXDJR1.jogTop");
    has("0x91", "0x3B", "PioneerXDJR1.modeButton");
    for (const note of ["0x2E", "0x2F", "0x30", "0x19", "0x5F", "0x55"]) has("0x90", note, "PioneerXDJR1.pad");
    for (const note of ["0x46", "0x47", "0x48", "0x49"]) {
        has("0x94", note, "PioneerXDJR1.beatFxButton");
        has("0x95", note, "PioneerXDJR1.beatFxButton");
    }
    has("0xB5", "0x00", "PioneerXDJR1.beatFxBeat");
    has("0xB4", "0x02", "PioneerXDJR1.beatFxLevelMsb");
    has("0x91", "0x42", "PioneerXDJR1.selectPress");
    has("0x90", "0x56", "PioneerXDJR1.quantizeButton");
    has("0x91", "0x3E", "PioneerXDJR1.matchButton");
    has("0xB0", "0x40", "PioneerXDJR1.selectTurn");
    has("0xB1", "0x41", "PioneerXDJR1.selectTurn");
    has("0x94", "0x74", "PioneerXDJR1.keepLowsButton");
    has("0x95", "0x74", "PioneerXDJR1.keepLowsButton");
    for (const chain of ["RX3 PITCH.xml", "RX3 CRUSH.xml", "XDJ-R1 BEAT FX.xml"]) {
        assert.ok(fs.existsSync(path.join(root, "effects", "chains", chain)), chain);
    }
}

console.log("Pioneer XDJ-R1 preset tests passed");
