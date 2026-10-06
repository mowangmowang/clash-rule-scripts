'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { root, scripts, sample, providerOnly, load, plain, assertIntegrity, routeDomain } = require('./helpers.cjs');
const fixtures = require('./fixtures/overlaps.json');

for (const file of scripts) {
    test(`${file}: syntax, LF, existing routing and graph`, () => {
        const source = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(!source.includes('\r'), 'source must use LF');
        const out = load(file).run(sample());
        assertIntegrity(out);
        assert.equal(out['rule-providers'].whatsapp.url,
            'https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash/Whatsapp/Whatsapp.yaml');
        assert.ok(out.rules.includes('DOMAIN-SUFFIX,spanishdict.com,Select Node'));
        assert.equal(out.rules.at(-1), 'MATCH,Fallback');
        const mobile = /mobile|Bettbox/.test(file);
        assert.equal(out.rules.some(rule => rule.includes('steampipe')), !mobile);
        assert.equal(out.rules.some(rule => rule.startsWith('PROCESS-NAME')), !mobile);
        if (!mobile) assert.equal(routeDomain(out, 'steampipe.akamaized.net', fixtures), 'DIRECT');
    });
    test(`${file}: DNS IPv6 is configurable and top-level ownership is respected`, () => {
        const mobile = /mobile|Bettbox/.test(file);
        for (const dnsEnabled of [false, true]) {
            const runner = load(file, source => source.replace('const ENABLE_IPV6 = false;', `const ENABLE_IPV6 = ${dnsEnabled};`));
            for (const appValue of [undefined, false, true]) {
                const input = sample();
                if (appValue !== undefined) input.ipv6 = appValue;
                const out = runner.run(input);
                assert.equal(out.dns.ipv6, dnsEnabled);
                if (mobile) {
                    assert.equal(out.ipv6, dnsEnabled);
                } else {
                    assert.equal(Object.hasOwn(out, 'ipv6'), appValue !== undefined,
                        'desktop must neither add nor delete the app-owned field');
                    assert.equal(out.ipv6, appValue, 'desktop must preserve the application value');
                }
                assert.equal(input.ipv6, appValue, 'input must remain unchanged');
                assert.equal(Object.hasOwn(input, 'ipv6'), appValue !== undefined);
            }
        }
    });
    test(`${file}: sniffer has protocol and platform settings`, () => {
        const sniff = plain(load(file).run(sample()).sniffer);
        assert.equal(sniff.enable, true);
        assert.equal(sniff['force-dns-mapping'], true);
        assert.equal(sniff['parse-pure-ip'], true);
        assert.equal(sniff['override-destination'], false);
        assert.deepEqual(sniff.sniff, { HTTP: { ports: [80, '8080-8880'] }, TLS: { ports: [443, 8443] }, QUIC: { ports: [443, 8443] } });
        assert.deepEqual(sniff['skip-domain'], /mobile|Bettbox/.test(file)
            ? ['+.mijia.cloud', '+.apple.com', '+.captive.apple.com', '+.gstatic.com', '+.icloud.com']
            : ['+.mijia.cloud', '+.apple.com', '+.msftconnecttest.com']);
    });
    test(`${file}: service and blocking precedence`, () => {
        const out = load(file).run(sample());
        const index = name => out.rules.findIndex(rule => rule.startsWith(`RULE-SET,${name},`));
        assert.ok(index('instagram') < index('facebook'));
        assert.ok(index('microsoft') < index('proxy'));
        assert.ok(index('apple') < index('proxy'));
        for (const domain of ['www.instagram.com', 'scontent.cdninstagram.com', 'instagr.am'])
            assert.equal(routeDomain(out, domain, fixtures), 'Instagram', domain);
        for (const domain of ['1drv.ms', 'aka.ms']) assert.equal(routeDomain(out, domain, fixtures), 'Microsoft Services', domain);
        for (const domain of ['caclick.baidu.com', 'mobads.baidu.com', 'kepler.jd.com'])
            assert.equal(routeDomain(out, domain, fixtures), 'Ad Block', domain);
        assert.ok(index('advertising') < out.rules.indexOf('DOMAIN-SUFFIX,baidu.com,DIRECT'));
        assert.ok(index('privacy') < out.rules.indexOf('DOMAIN-SUFFIX,baidu.com,DIRECT'));
        assert.equal(routeDomain(out, 'www.baidu.com', fixtures), 'DIRECT');
        assert.equal(routeDomain(out, 'copilot.microsoft.com', fixtures), 'AI Overseas');
        assert.equal(routeDomain(out, 'bing.com', fixtures), 'Microsoft Services');
        assert.equal(routeDomain(out, 'apps.microsoft.com', fixtures), 'DIRECT');
    });
    test(`${file}: input validation and provider-only`, () => {
        const script = load(file);
        for (const input of [null, undefined, [], 'invalid', 123]) assert.throws(() => script.run(input), /configuration.*object/i);
        assert.throws(() => script.run({}), /No proxies found/);
        assert.throws(() => script.run({ proxies: null, 'proxy-providers': null }), /No proxies found/);
        assertIntegrity(script.run({ ...sample(), 'proxy-providers': null }));
        assertIntegrity(script.run(providerOnly()));
        assertIntegrity(script.run({ ...providerOnly(), proxies: null }));
        for (const value of [{}, 'bad', 123]) assert.throws(() => script.run({ proxies: value }), /proxies.*array/i);
        for (const value of [[], 'bad', 123]) assert.throws(() => script.run({ ...sample(), 'proxy-providers': value }), /proxy-providers.*object/i);
        assert.throws(() => script.run(sample(['duplicate', 'duplicate'])), /duplicate/i);
        for (const name of ['Others', 'Select Node', 'DIRECT', 'GLOBAL', 'HK - 香港'])
            assert.throws(() => script.run(sample([name])), /conflict|reserved/i);
        for (const name of ['', '   ', null]) assert.throws(() => script.run(sample([name])), /name/i);
        assert.throws(() => script.run({ proxies: [null] }), /name|proxy/i);
    });
    test(`${file}: output isolation`, () => {
        const script = load(file), input = sample(), before = plain(input);
        input.proxies[0].extra = { nested: ['original'] };
        const first = script.run(input), second = script.run(input), secondBefore = plain(second);
        first.dns.nameserver.push('https://fixture.invalid/dns-query');
        first['rule-providers'].whatsapp.url = 'https://fixture.invalid';
        first.rules.push('DOMAIN,fixture.invalid,DIRECT');
        first.proxies[0].extra.nested.push('changed');
        const google = first['proxy-groups'].find(group => group.name === 'Google Services');
        const github = first['proxy-groups'].find(group => group.name === 'GitHub');
        const githubBefore = plain(github);
        google.proxies.push('REJECT');
        assert.deepEqual(plain(github), githubBefore);
        assert.deepEqual(plain(second), secondBefore);
        assert.deepEqual(plain(script.run(input)), secondBefore);
        assert.deepEqual(input.proxies[0].extra.nested, ['original']);
        delete input.proxies[0].extra;
        assert.deepEqual(plain(input), before);
    });
}

test('desktop Chinese and English outputs are identical', () => {
    for (const input of [sample(), sample(['DE 01']), providerOnly()])
        assert.deepEqual(plain(load(scripts[0]).run(input)), plain(load(scripts[1]).run(input)));
});

test('desktop Store process expression is anchored and escaped', () => {
    for (const file of scripts.slice(0, 2)) {
        const rules = load(file).run(sample()).rules;
        assert.ok(rules.includes('PROCESS-NAME-REGEX,(?i)^Microsoft\\.WindowsStore.*$,DIRECT'));
        assert.ok(!rules.includes('PROCESS-NAME,Microsoft.WindowsStore*,DIRECT'));
        assert.ok(rules.includes('PROCESS-NAME,WinStore.App.exe,DIRECT'));
        assert.ok(rules.includes('PROCESS-NAME,Microsoft.StorePurchaseApp.exe,DIRECT'));
    }
});

test('Bettbox single switches, chained fallbacks and 834 combinations', () => {
    const script = load(scripts[3]);
    const keys = plain(script.evaluate('Object.keys(ruleOptionsEnable)'));
    assert.equal(keys.length, 24);
    function set(key, value) { script.evaluate(`ruleOptionsEnable[${JSON.stringify(key)}] = ${value}`); }
    for (const key of keys) {
        set(key, false);
        const out = script.run(sample());
        assertIntegrity(out);
        assert.ok(!out['proxy-groups'].some(group => group.name === key));
        set(key, true);
    }
    set('Instagram', false);
    assert.equal(routeDomain(script.run(sample()), 'instagram.com', fixtures), 'Social Media');
    set('Social Media', false);
    assert.equal(routeDomain(script.run(sample()), 'instagram.com', fixtures), 'Fallback');
    let cases = 0;
    for (const input of [sample(), sample(['DE 01']), providerOnly()]) {
        script.evaluate('Object.keys(ruleOptionsEnable).forEach(key => ruleOptionsEnable[key] = true)');
        assertIntegrity(script.run(input)); cases++;
        for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
            set(keys[i], false); set(keys[j], false);
            assertIntegrity(script.run(input)); cases++;
            set(keys[i], true); set(keys[j], true);
        }
        script.evaluate('Object.keys(ruleOptionsEnable).forEach(key => ruleOptionsEnable[key] = false)');
        const out = script.run(input); assertIntegrity(out); cases++;
        assert.deepEqual(out['proxy-groups'].map(group => group.name).join(','), 'Select Node,Fallback');
    }
    assert.equal(cases, 834);
    const fallbacks = plain(script.evaluate('serviceConfigs.map(service => [service.name, service.fallback])'));
    assert.deepEqual(new Set(fallbacks.map(([name]) => name)), new Set(keys));
    for (const [name] of fallbacks) {
        const result = script.evaluate(`_resolveTarget(${JSON.stringify(name)}, _buildEnabledSet(), _buildFallbackMap())`);
        assert.ok(['Select Node', 'Fallback', 'DIRECT', 'REJECT'].includes(result));
    }
    assert.equal(script.evaluate('_resolveTarget("cycle", _buildEnabledSet(), new Map([["cycle", "cycle"]]))'), 'Fallback');
});
