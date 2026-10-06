'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scripts } = require('./helpers.cjs');
const { inputs, evidenceLocation, validateEvidence, clientChecks, tagMode, validateTagDetail, validateReleaseDetail, releaseNotes } = require('../tools/release.cjs');

const env = { RELEASE_VERSION: '1.6.1', TARGET_SHA: 'a'.repeat(40), CLIENTS_VERIFIED: 'true',
    RELEASE_RESUME: 'false', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'owner/repo',
    EVIDENCE_URL: 'https://github.com/owner/repo/pull/42#issuecomment-123' };
const hashes = Object.fromEntries(scripts.map(file => [file, 'b'.repeat(64)]));
function record() {
    return { version: '1.6.1', files: { ...hashes }, clients: Object.fromEntries(Object.entries(clientChecks).map(([name, checks]) =>
        [name, { name: 'test fixture client', version: '0.0.0', checks: Object.fromEntries(checks.map(check => [check, true])) }])) };
}
test('publication rejects unchecked clients, abbreviated SHAs, branch dispatch and unsafe version input', () => {
    assert.equal(inputs(env).sha, env.TARGET_SHA);
    for (const [key, value] of [['CLIENTS_VERIFIED', 'false'], ['TARGET_SHA', 'abcdef'], ['GITHUB_REF', 'refs/heads/fix/test'],
        ['RELEASE_VERSION', '1.6.1;echo unsafe'], ['RELEASE_VERSION', '01.6.1'], ['RELEASE_RESUME', 'yes']])
        assert.throws(() => inputs({ ...env, [key]: value }));
});
test('acceptance URL must identify a comment on this repository PR', () => {
    assert.deepEqual(evidenceLocation(env.EVIDENCE_URL, 'owner/repo'), { pr: 42, comment: '123' });
    for (const url of ['https://github.com/other/repo/pull/42#issuecomment-123', 'https://example.com/owner/repo/pull/42#issuecomment-123',
        'https://github.com/owner/repo/issues/42#issuecomment-123', 'https://github.com/owner/repo/pull/42'])
        assert.throws(() => evidenceLocation(url, 'owner/repo'));
});
test('acceptance is tied to four exact hashes, all clients and every mandatory check', () => {
    const options = inputs(env);
    assert.doesNotThrow(() => validateEvidence(record(), options, hashes, 'OWNER'));
    assert.throws(() => validateEvidence(record(), options, hashes, 'CONTRIBUTOR'));
    for (const file of scripts) { const data = record(); data.files[file] = 'c'.repeat(64); assert.throws(() => validateEvidence(data, options, hashes, 'OWNER')); }
    for (const [kind, checks] of Object.entries(clientChecks)) {
        for (const check of checks) { const data = record(); data.clients[kind].checks[check] = false; assert.throws(() => validateEvidence(data, options, hashes, 'OWNER')); }
        const data = record(); delete data.clients[kind]; assert.throws(() => validateEvidence(data, options, hashes, 'OWNER'));
    }
});
test('resume only reuses both annotated tags with matching version, message and commit', () => {
    assert.equal(tagMode([null, null], false), 'create');
    assert.equal(tagMode([{}, {}], true), 'reuse');
    assert.throws(() => tagMode([{}, {}], false));
    assert.throws(() => tagMode([{}, null], true));
    const detail = { tag: 'desktop-v1.6.1', object: { type: 'commit', sha: env.TARGET_SHA },
        message: 'Desktop v1.6.1: configuration and routing hardening\n' };
    assert.doesNotThrow(() => validateTagDetail(detail.tag, detail, inputs(env), 'Desktop'));
    for (const changed of [{ ...detail, message: 'other' }, { ...detail, object: { type: 'commit', sha: 'c'.repeat(40) } },
        { ...detail, object: { type: 'tag', sha: env.TARGET_SHA } }]) assert.throws(() => validateTagDetail(detail.tag, changed, inputs(env), 'Desktop'));
});
test('resume preserves release notes and metadata, allowing only a different run URL', () => {
    const manifest = { ...inputs(env), resume: true, validationUrl: 'https://github.com/owner/repo/actions/runs/1', releaseRun: 'old' };
    const release = { tag_name: 'desktop-v1.6.1', name: 'Desktop v1.6.1', target_commitish: manifest.sha,
        prerelease: false, body: releaseNotes(manifest, 'Desktop') };
    assert.doesNotThrow(() => validateReleaseDetail(release, { ...manifest, releaseRun: 'new' }, 'desktop'));
    for (const changed of [{ ...release, body: release.body.replace('Correct IPv6', 'Different description') },
        { ...release, target_commitish: 'b'.repeat(40) }, { ...release, prerelease: true }])
        assert.throws(() => validateReleaseDetail(changed, manifest, 'desktop'));
});
