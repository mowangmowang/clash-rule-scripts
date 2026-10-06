'use strict';

// Exercise the actual publication orchestration with a fake Git/REST backend.
// No network, tags, real Releases or repository modifications are performed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const helpers = require('./helpers.cjs');
const { hash } = require('../tools/core-check.cjs');

test('publication creates verified drafts, survives one public release, and refuses changed published assets', t => {
    const realRoot = helpers.root;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myscript-publication-test-'));
    helpers.root = directory;
    const version = '1.6.1';
    const sha = 'a'.repeat(40);
    let mainSha = sha;
    const options = { version, sha, repo: 'owner/repo', evidenceUrl: 'https://github.com/owner/repo/pull/42#issuecomment-123', resume: false };
    const hashes = {};
    for (const file of helpers.scripts) {
        const source = fs.readFileSync(path.join(realRoot, file), 'utf8')
            .replace(/(@version\s+)[^\s]+/, `$1${version}`).replace(/(@basedon\s+Clash_script_mobile\.js\s+v)[^\s]+/, `$1${version}`);
        fs.writeFileSync(path.join(directory, file), source);
        hashes[file] = hash(Buffer.from(source));
    }
    for (const file of ['README.md', 'README_EN.md']) fs.writeFileSync(path.join(directory, file), `desktop-v${version}`);
    fs.writeFileSync(path.join(directory, 'CHANGELOG.md'), `### [desktop-v${version}]\n### [mobile-v${version}]`);
    const releases = new Map();
    const refs = new Map();
    const localTags = new Map();
    const assets = new Map();
    const mutations = [];
    let draftTagLookups = 0;
    let assetId = 0;
    let failSecondPublication = true;
    const success = stdout => ({ status: 0, stdout, stderr: '' });
    const failure = stderr => ({ status: 1, stdout: '', stderr });
    t.mock.method(cp, 'spawnSync', (binary, args, spawnOptions) => {
        if (binary === 'git') {
            if (args[0] === 'fetch' || args[0] === 'config') return success('');
            if (args[0] === 'rev-parse') return success(mainSha);
            if (args[0] === 'merge-base') return success('');
            if (args[0] === 'show') return success(fs.readFileSync(path.join(directory, args[1].split(':')[1])));
            if (args[0] === 'tag') { localTags.set(args[2], args.at(-1)); mutations.push(['tag', args[2]]); return success(''); }
            if (args[0] === 'push') {
                assert.deepEqual(args.slice(0, 3), ['push', '--atomic', 'origin']);
                for (const tag of args.slice(3)) refs.set(tag, { object: { type: 'tag', sha: tag } });
                mutations.push(['atomic-push']); return success('');
            }
            throw new Error(`Unexpected git operation ${args}`);
        }
        assert.equal(binary, 'gh');
        if (args[0] === 'api') {
            const endpoint = args[1];
            let data;
            if (endpoint.endsWith('/issues/comments/123')) data = { issue_url: 'https://api.github.com/repos/owner/repo/issues/42',
                author_association: 'OWNER', body: '<!-- myscript-client-acceptance -->\n```json\n' + JSON.stringify({ version, files: hashes,
                    clients: Object.fromEntries(Object.entries(require('../tools/release.cjs').clientChecks).map(([kind, checks]) =>
                        [kind, { name: 'fixture', version: '0.0.0', checks: Object.fromEntries(checks.map(check => [check, true])) }])) }) + '\n```' };
            else if (endpoint.endsWith('/pulls/42')) data = { merged: true, base: { ref: 'main', repo: { full_name: 'owner/repo' } }, merge_commit_sha: sha };
            else if (endpoint.includes('/actions/workflows/')) {
                const ciSha = new URL('https://api.github.com/' + endpoint).searchParams.get('head_sha');
                data = { workflow_runs: [{ id: ciSha === sha ? 1 : 2, head_sha: ciSha, status: 'completed', conclusion: 'success',
                    html_url: `https://github.com/owner/repo/actions/runs/${ciSha === sha ? 1 : 2}` }] };
            }
            else if (endpoint.endsWith('/git/ref/heads/main')) data = { object: { sha: mainSha } };
            else if (endpoint.includes('/git/ref/tags/')) data = refs.get(endpoint.split('/').at(-1));
            else if (endpoint.includes('/git/tags/')) {
                const tag = endpoint.split('/').at(-1);
                data = { tag, object: { type: 'commit', sha }, message: localTags.get(tag) };
            } else if (endpoint.includes('/releases?')) data = [...releases.values()];
            else if (endpoint.includes('/releases/tags/')) {
                data = releases.get(endpoint.split('/').at(-1));
                if (data?.draft) { draftTagLookups++; return failure('HTTP 404'); }
            }
            else if (endpoint.includes('/releases/assets/')) return success(assets.get(Number(endpoint.split('/').at(-1))));
            else if (/\/releases\/\d+$/.test(endpoint)) data = [...releases.values()].find(item => item.id === Number(endpoint.split('/').at(-1)));
            else throw new Error(`Unexpected API: ${endpoint}`);
            return data ? success(JSON.stringify(data)) : failure('HTTP 404');
        }
        assert.equal(args[0], 'release');
        const tag = args[2];
        if (args[1] === 'create') {
            assert.ok(args.includes('--draft')); assert.ok(args.includes('--verify-tag'));
            releases.set(tag, { id: releases.size + 1, tag_name: tag, name: args[args.indexOf('--title') + 1], target_commitish: sha, draft: true,
                prerelease: false, body: fs.readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8'), assets: [], html_url: `https://github.com/owner/repo/releases/tag/${tag}` });
            mutations.push(['draft', tag]);
        } else if (args[1] === 'upload') {
            assert.ok(!args.includes('--clobber'));
            const release = releases.get(tag); assert.ok(release.draft);
            const name = path.basename(args[3]);
            const id = ++assetId;
            assets.set(id, fs.readFileSync(args[3])); release.assets.push({ name, id }); mutations.push(['upload', tag, name]);
        } else if (args[1] === 'edit') {
            if (tag.startsWith('mobile') && failSecondPublication) return failure('simulated partial API outage');
            assert.ok(args.includes('--draft=false'));
            assert.ok([...releases.values()].every(release => release.assets.length === 3));
            releases.get(tag).draft = false; mutations.push(['public', tag]);
        } else throw new Error(`Unexpected release operation ${args}`);
        return success(spawnOptions.encoding ? '' : Buffer.alloc(0));
    });
    const modulePath = require.resolve('../tools/release.cjs');
    delete require.cache[modulePath];
    const tooling = require(modulePath);
    t.after(() => { helpers.root = realRoot; delete require.cache[modulePath]; });
    tooling.packageRelease({ ...options, mainSha: sha, hashes, validationUrl: 'https://github.com/owner/repo/actions/runs/1', releaseRun: 'fixture' });
    assert.throws(() => tooling.publish(options), /simulated partial API outage/);
    assert.equal(refs.size, 2);
    assert.equal(releases.get('desktop-v1.6.1').draft, false);
    assert.equal(releases.get('mobile-v1.6.1').draft, true);
    assert.throws(() => tooling.publish(options), /Existing tags require resume/);
    failSecondPublication = false;
    mainSha = 'b'.repeat(40); // A tooling-only repair merged after the immutable tags.
    assert.throws(() => tooling.publish({ ...options, resume: true }), /Stale packaging manifest/);
    tooling.packageRelease({ ...options, mainSha, hashes, validationUrl: 'https://github.com/owner/repo/actions/runs/1',
        toolingValidationUrl: 'https://github.com/owner/repo/actions/runs/2', releaseRun: 'new fixture' });
    const mutationCount = mutations.length;
    tooling.publish({ ...options, resume: true });
    assert.deepEqual(mutations.slice(mutationCount), [['public', 'mobile-v1.6.1']]);
    assert.equal(releases.get('mobile-v1.6.1').draft, false);
    const published = releases.get('desktop-v1.6.1').assets[0];
    assets.set(published.id, Buffer.from('changed public content'));
    const beforeConflict = mutations.length;
    assert.throws(() => tooling.publish({ ...options, resume: true }), /Existing asset differs/);
    assert.equal(mutations.length, beforeConflict, 'conflicts must not overwrite or republish anything');
    assert.equal(draftTagLookups, 0, 'drafts must never be queried through the published-tag endpoint');
});

test('release discovery includes paginated drafts and rejects duplicate tags', t => {
    const target = { id: 101, tag_name: 'desktop-v1.6.1', draft: true };
    let duplicate = false;
    const endpoints = [];
    t.mock.method(cp, 'spawnSync', (binary, args) => {
        assert.equal(binary, 'gh');
        assert.equal(args[0], 'api');
        endpoints.push(args[1]);
        const page = new URL('https://api.github.com/' + args[1]).searchParams.get('page');
        const items = page === '1' ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `older-${i}` })) : [target];
        if (duplicate && page === '1') items[0] = target;
        return { status: 0, stdout: JSON.stringify(items), stderr: '' };
    });
    const modulePath = require.resolve('../tools/release.cjs');
    delete require.cache[modulePath];
    const tooling = require(modulePath);
    t.after(() => delete require.cache[modulePath]);
    assert.deepEqual(tooling.findRelease('owner/repo', target.tag_name), target);
    assert.equal(endpoints.length, 2);
    assert.equal(tooling.findRelease('owner/repo', 'missing'), null);
    duplicate = true;
    assert.throws(() => tooling.findRelease('owner/repo', target.tag_name), /Duplicate releases/);
});

test('recovery after a tooling fix requires existing immutable tags, ancestry and identical scripts', t => {
    const sha = 'a'.repeat(40), mainSha = 'b'.repeat(40);
    const options = { version: '1.6.1', sha, repo: 'owner/repo', resume: true };
    let ancestor = true, changedFile = false, missingTag = false, tagConflict = false, staleCheckout = false;
    t.mock.method(cp, 'spawnSync', (binary, args) => {
        let stdout = '';
        if (binary === 'git') {
            if (args[0] === 'rev-parse') stdout = args[1] === 'HEAD' && staleCheckout ? 'c'.repeat(40) : mainSha;
            else if (args[0] === 'merge-base') return { status: ancestor ? 0 : 1, stdout: '', stderr: 'not an ancestor' };
            else if (args[0] === 'show') stdout = changedFile ? Buffer.from('different') : fs.readFileSync(path.join(helpers.root, args[1].split(':')[1]));
            else throw new Error(`Unexpected git: ${args}`);
        } else {
            assert.equal(binary, 'gh');
            const tag = args[1].split('/').at(-1);
            if (args[1].includes('/git/ref/tags/')) {
                if (missingTag) return { status: 1, stdout: '', stderr: 'HTTP 404' };
                stdout = JSON.stringify({ object: { type: 'tag', sha: tag } });
            } else if (args[1].includes('/git/tags/')) stdout = JSON.stringify({ tag, object: { type: 'commit', sha: tagConflict ? mainSha : sha },
                message: `${tag.startsWith('desktop') ? 'Desktop' : 'Mobile'} v1.6.1: configuration and routing hardening` });
            else throw new Error(`Unexpected API: ${args}`);
        }
        return { status: 0, stdout, stderr: '' };
    });
    const modulePath = require.resolve('../tools/release.cjs');
    delete require.cache[modulePath];
    const tooling = require(modulePath);
    t.after(() => delete require.cache[modulePath]);
    assert.equal(tooling.validateTarget(options).mainSha, mainSha);
    assert.throws(() => tooling.validateTarget({ ...options, resume: false }), /no longer current main/);
    ancestor = false; assert.throws(() => tooling.validateTarget(options), /not an ancestor/); ancestor = true;
    changedFile = true; assert.throws(() => tooling.validateTarget(options), /script differs/); changedFile = false;
    missingTag = true; assert.throws(() => tooling.validateTarget(options), /HTTP 404/); missingTag = false;
    tagConflict = true; assert.throws(() => tooling.validateTarget(options), /Conflicting immutable tag/); tagConflict = false;
    staleCheckout = true; assert.throws(() => tooling.validateTarget(options), /no longer current main/);
});
