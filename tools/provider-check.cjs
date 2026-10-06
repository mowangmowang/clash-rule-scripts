'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { root, scripts, sample, load } = require('../tests/helpers.cjs');
const { download, hash, coreCheck } = require('./core-check.cjs');
const fixtures = require('../tests/fixtures/overlaps.json');

async function providerCheck() {
    const providers = new Map();
    for (const script of scripts) {
        for (const provider of Object.values(load(script).run(sample())['rule-providers'])) {
            if (!providers.has(provider.url)) providers.set(provider.url, null);
        }
    }
    const report = [];
    // Bounded concurrency avoids saturating upstream hosts.
    const urls = [...providers.keys()];
    for (let i = 0; i < urls.length; i += 4) {
        await Promise.all(urls.slice(i, i + 4).map(async url => {
            const data = await download(url);
            const text = data.toString('utf8');
            if (!/^payload\s*:/m.test(text) || !/^\s*-\s+\S/m.test(text)) throw new Error(`Missing YAML payload: ${url}`);
            providers.set(url, text);
            report.push({ url, sha256: hash(data), bytes: data.length });
        }));
    }
    for (const [name, fixture] of Object.entries(fixtures.providers)) {
        const source = fixtures.sources[fixture.source];
        const url = `https://raw.githubusercontent.com/${source.repository}/${source.commit}/${fixture.path}`;
        const text = (await download(url)).toString('utf8');
        const entries = new Set(text.split(/\r?\n/).map(line => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '')));
        for (const rule of fixture.payload) if (!entries.has(rule)) throw new Error(`Fixture ${name} is absent at pinned source: ${rule}`);
    }
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'reports', 'providers.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS ${providers.size} live providers and pinned fixture provenance`);
    await coreCheck(providers);
}
module.exports = { providerCheck };
if (require.main === module) providerCheck().catch(error => { console.error(error.message); process.exitCode = 1; });
