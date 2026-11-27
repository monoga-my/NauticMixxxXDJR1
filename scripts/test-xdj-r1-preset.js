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

function load() {
    const values = new Map();
    const midiCalls = [];
    const engine = {
        setValue(group, key, value) { values.set(`${group},${key}`, value); },
        getValue(group, key) { return values.get(`${group},${key}`) || 0; },
        softTakeover() {},
        softTakeoverIgnoreNextValue() {},
        makeConnection() { return {disconnect() {}}; },
        beginTimer() { return 1; },
        stopTimer() {},
    };
    const sandbox = {
        console, engine, Date,
        midi: {sendShortMsg(status, control, value) { midiCalls.push([status, control, value]); }},
    };
    vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), sandbox, {filename: scriptPath});
    return {mapping: sandbox.PioneerXDJR1, values, midiCalls};
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
    for (const chain of ["RX3 PITCH.xml", "RX3 CRUSH.xml"]) {
        assert.ok(fs.existsSync(path.join(root, "effects", "chains", chain)), chain);
    }
}

console.log("Pioneer XDJ-R1 preset tests passed");
