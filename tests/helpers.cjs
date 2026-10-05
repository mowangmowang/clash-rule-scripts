'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const scripts = ['Clash_script_v1.js', 'Clash_script_v1_en.js', 'Clash_script_mobile.js', 'ClashScript_ForBettbox.js'];
const normalNames = ['香港 01', '日本 01', 'US 01', 'SG 01', 'TW 01', 'Germany 01'];
const builtinTargets = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL']);

function sample(names = normalNames) {
    return { proxies: names.map(name => ({ name, type: 'ss', server: 'example.com', port: 443,
        cipher: 'aes-128-gcm', password: 'fixture-only', udp: true })) };
}

function providerOnly() {
    return { 'proxy-providers': { subscription: { type: 'file', path: 'nodes.yaml' } } };
}

function load(file, transform = source => source) {
    const source = transform(fs.readFileSync(path.join(root, file), 'utf8'));
    const context = vm.createContext({});
    vm.runInContext(source, context, { filename: file, timeout: 5000 });
    return {
        run(config) { context.fixtureConfig = config;
            return vm.runInContext('main(fixtureConfig)', context, { timeout: 5000 }); },
        evaluate(code) { return vm.runInContext(code, context, { timeout: 5000 }); }
    };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }
function target(rule) { const parts = rule.split(','); if (parts.at(-1) === 'no-resolve') parts.pop(); return parts.at(-1); }

function assertIntegrity(config) {
    const groups = config['proxy-groups'];
    const names = new Set(groups.map(group => group.name));
    assert.equal(names.size, groups.length, 'duplicate generated group');
    const valid = new Set([...names, ...config.proxies.map(proxy => proxy.name), ...builtinTargets]);
    const graph = new Map();
    for (const group of groups) {
        assert.ok((group.proxies || []).length || group['include-all'] || (group.use || []).length,
            `group ${group.name} has no node source`);
        for (const upstream of group.proxies || []) assert.ok(valid.has(upstream), `${group.name} -> ${upstream}`);
        graph.set(group.name, (group.proxies || []).filter(upstream => names.has(upstream)));
    }
    for (const rule of config.rules) {
        assert.ok(valid.has(target(rule)), `unknown target in ${rule}`);
        if (rule.startsWith('RULE-SET,')) assert.ok(config['rule-providers'][rule.split(',')[1]], rule);
    }
    const done = new Set();
    function visit(name, active = new Set()) {
        assert.ok(!active.has(name), `proxy group cycle at ${name}`);
        if (done.has(name)) return;
        const next = new Set(active); next.add(name);
        for (const child of graph.get(name)) visit(child, next);
        done.add(name);
    }
    for (const name of names) visit(name);
}

// Deliberately supports only domain cases exercised by the provenance fixtures.
// Native parser validation independently checks the complete generated syntax.
function domainMatches(rule, domain, behavior) {
    if (behavior === 'domain') {
        const suffix = rule.replace(/^\+\.|^\*\./, '');
        return domain === suffix || domain.endsWith('.' + suffix);
    }
    const [type, value] = rule.split(',');
    if (type === 'DOMAIN') return domain === value;
    if (type === 'DOMAIN-SUFFIX') return domain === value || domain.endsWith('.' + value);
    if (type === 'DOMAIN-KEYWORD') return domain.includes(value);
    return false;
}

function routeDomain(config, domain, fixtures) {
    for (const rule of config.rules) {
        const [type, value] = rule.split(',');
        if (type === 'RULE-SET') {
            const provider = fixtures.providers[value];
            if (provider && provider.payload.some(item => domainMatches(item, domain, provider.behavior))) return target(rule);
        } else if (domainMatches(rule, domain)) return target(rule);
        else if (type === 'MATCH') return target(rule);
    }
    throw new Error('Missing MATCH rule');
}

module.exports = { root, scripts, sample, providerOnly, load, plain, target, assertIntegrity, routeDomain };
