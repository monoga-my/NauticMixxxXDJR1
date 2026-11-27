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

// Beat FX: deck 1 uses effect unit 3, deck 2 unit 4; ROLL is a loop roll.
{
    const {mapping, values, midiCalls} = load();
    mapping.init();
    assert.equal(values.get("[EffectRack1_EffectUnit3],group_[Channel1]_enable"), 1);
    assert.equal(values.get("[EffectRack1_EffectUnit3],group_[Channel2]_enable"), 0);
    assert.equal(values.get("[EffectRack1_EffectUnit4],group_[Channel2]_enable"), 1);

    mapping.beatFxBeat(0, 0x00, 0x60, 0xB4); // 0x60 -> index 6 = 4 beats
    mapping.beatFxLevelMsb(0, 0x02, 0x40, 0xB4);
    mapping.beatFxButton(0, 0x48, 0x7F, 0x94); // ECHO on deck 1
    assert.equal(values.get("[EffectRack1_EffectUnit3],loaded_chain_preset"), 3);
    assert.equal(values.get("[EffectRack1_EffectUnit3],enabled"), 1);
    close(values.get("[EffectRack1_EffectUnit3],mix"), 0x40 * 128 / 16383);
    assert.equal(values.get("[EffectRack1_EffectUnit3_Effect1],parameter1"), 4, "echo delay in beats");
    assert.ok(midiCalls.some(c => c[0] === 0x94 && c[1] === 0x48 && c[2] === 0x7F), "ECHO lit");

    mapping.beatFxButton(0, 0x46, 0x7F, 0x95); // TRANS on deck 2
    assert.equal(values.get("[EffectRack1_EffectUnit4],loaded_chain_preset"), 1);
    assert.equal(values.get("[EffectRack1_EffectUnit4_Effect1],parameter2"), 1, "tremolo rate");

    mapping.beatFxButton(0, 0x49, 0x7F, 0x94); // ROLL on deck 1
    assert.equal(values.get("[EffectRack1_EffectUnit3],enabled"), 0);
    assert.equal(values.get("[Channel1],beatlooproll_4_activate"), 1);
    mapping.beatFxBeat(0, 0x00, 0x00, 0xB4); // 1/16 beat
    assert.equal(values.get("[Channel1],beatlooproll_4_activate"), 0);
    assert.equal(values.get("[Channel1],beatlooproll_0.0625_activate"), 1);
    mapping.beatFxButton(0, 0x65, 0x7F, 0x94); // SHIFT + ROLL again = off
    assert.equal(values.get("[Channel1],beatlooproll_0.0625_activate"), 0);
    assert.equal(mapping.beatFxSelected[1], 0);
    assert.equal(values.get("[EffectRack1_EffectUnit4],enabled"), 1, "deck 2 FX unaffected");
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
    for (const chain of ["RX3 PITCH.xml", "RX3 CRUSH.xml", "XDJ-R1 TRANS.xml",
        "XDJ-R1 FLANGER.xml", "XDJ-R1 ECHO.xml"]) {
        assert.ok(fs.existsSync(path.join(root, "effects", "chains", chain)), chain);
    }
}

console.log("Pioneer XDJ-R1 preset tests passed");
