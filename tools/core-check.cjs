'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { root, scripts, sample, providerOnly, load, plain } = require('../tests/helpers.cjs');
const lock = require('./toolchain-lock.json');
const fixtures = require('../tests/fixtures/overlaps.json');

function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
async function download(url) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) { failure = error; }
    }
    throw failure;
}
async function lockedFile(url, digest, cache) {
    const file = path.join(cache, digest);
    let data = fs.existsSync(file) ? fs.readFileSync(file) : await download(url);
    if (hash(data) !== digest) throw new Error(`Checksum mismatch: ${url}`);
    fs.writeFileSync(file, data);
    return data;
}
function execute(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    return result.stdout + result.stderr;
}
async function prepareToolchain(directory) {
    const platform = process.platform;
    if (!['linux', 'win32'].includes(platform) || process.arch !== 'x64') throw new Error('Locked toolchain requires Linux/Windows x64');
    const cache = process.env.MYSCRIPT_TOOL_CACHE || path.join(os.tmpdir(), 'myscript-toolchain');
    fs.mkdirSync(cache, { recursive: true });
    const asset = lock.mihomo[platform];
    const archive = await lockedFile(asset.url, asset.sha256, cache);
    const binary = path.join(directory, platform === 'linux' ? 'mihomo' : 'mihomo.exe');
    if (platform === 'linux') { fs.writeFileSync(binary, zlib.gunzipSync(archive), { mode: 0o755 }); }
    else {
        const zip = path.join(directory, 'mihomo.zip');
        const extracted = path.join(directory, 'extracted');
        fs.writeFileSync(zip, archive);
        const quote = value => "'" + value.replaceAll("'", "''") + "'";
        execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(extracted)}`]);
        const entries = fs.readdirSync(extracted).filter(name => /^mihomo.*\.exe$/i.test(name));
        if (entries.length !== 1) throw new Error('Unexpected Mihomo archive structure');
        fs.copyFileSync(path.join(extracted, entries[0]), binary);
    }
    for (const [name, digest] of Object.entries(lock.geodata.files)) {
        const url = `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/${lock.geodata.commit}/${name}`;
        const data = await lockedFile(url, digest, cache);
        fs.writeFileSync(path.join(directory, name === 'country.mmdb' ? 'Country.mmdb' : name), data);
    }
    return binary;
}
async function coreCheck(liveProviders) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myscript-core-'));
    const reports = path.join(root, 'reports');
    fs.mkdirSync(reports, { recursive: true });
    const binary = await prepareToolchain(directory);
    console.log(execute(binary, ['-v']).trim());
    for (const script of scripts) {
        for (const [kind, input] of [['inline', sample()], ['provider-only', providerOnly()]]) {
            const config = plain(load(script).run(input));
            const caseDir = path.join(directory, `${script}-${kind}`);
            fs.mkdirSync(caseDir);
            // Retain DNS, behavior, format and all rules. Only replace network sources.
            for (const [name, provider] of Object.entries(config['rule-providers'])) {
                const file = path.join(caseDir, `${name}.yaml`);
                const payload = fixtures.providers[name]?.payload ||
                    [provider.behavior === 'domain' ? '+.fixture.invalid' : 'DOMAIN,fixture.invalid'];
                const content = liveProviders ? liveProviders.get(provider.url) : JSON.stringify({ payload });
                if (!content) throw new Error(`Missing downloaded provider: ${name}`);
                fs.writeFileSync(file, content);
                provider.type = 'file'; provider.path = file;
                delete provider.url; delete provider.proxy;
            }
            for (const provider of Object.values(config['proxy-providers'] || {})) {
                const file = path.join(caseDir, 'nodes.yaml');
                fs.writeFileSync(file, JSON.stringify({ proxies: sample().proxies }));
                provider.type = 'file'; provider.path = file; delete provider.url;
            }
            const file = path.join(caseDir, 'config.json');
            fs.writeFileSync(file, JSON.stringify(config));
            const output = execute(binary, ['-t', '-d', directory, '-f', file]);
            fs.writeFileSync(path.join(reports, `${liveProviders ? 'live' : 'fixture'}-${script}-${kind}.log`), output);
            console.log(`PASS native config: ${script} (${kind})`);
        }
    }
    // Temporary fake configurations remain in the system temp directory for diagnosis.
    return directory;
}
module.exports = { hash, download, execute, coreCheck };
if (require.main === module) coreCheck().catch(error => { console.error(error.message); process.exitCode = 1; });
