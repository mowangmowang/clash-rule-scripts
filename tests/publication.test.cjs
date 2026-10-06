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
    let assetId = 0;
    let failSecondPublication = true;
    const success = stdout => ({ status: 0, stdout, stderr: '' });
    const failure = stderr => ({ status: 1, stdout: '', stderr });
    t.mock.method(cp, 'spawnSync', (binary, args, spawnOptions) => {
        if (binary === 'git') {
            if (args[0] === 'fetch' || args[0] === 'config') return success('');
            if (args[0] === 'rev-parse') return success(sha);
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
            else if (endpoint.includes('/actions/workflows/')) data = { workflow_runs: [{ id: 1, head_sha: sha, status: 'completed', conclusion: 'success', html_url: 'https://github.com/owner/repo/actions/runs/1' }] };
            else if (endpoint.endsWith('/git/ref/heads/main')) data = { object: { sha } };
            else if (endpoint.includes('/git/ref/tags/')) data = refs.get(endpoint.split('/').at(-1));
            else if (endpoint.includes('/git/tags/')) {
                const tag = endpoint.split('/').at(-1);
                data = { tag, object: { type: 'commit', sha }, message: localTags.get(tag) };
            } else if (endpoint.includes('/releases/tags/')) data = releases.get(endpoint.split('/').at(-1));
            else if (endpoint.includes('/releases/assets/')) return success(assets.get(Number(endpoint.split('/').at(-1))));
            else throw new Error(`Unexpected API: ${endpoint}`);
            return data ? success(JSON.stringify(data)) : failure('HTTP 404');
        }
        assert.equal(args[0], 'release');
        const tag = args[2];
        if (args[1] === 'create') {
            assert.ok(args.includes('--draft')); assert.ok(args.includes('--verify-tag'));
            releases.set(tag, { tag_name: tag, name: args[args.indexOf('--title') + 1], target_commitish: sha, draft: true,
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
    tooling.packageRelease({ ...options, hashes, validationUrl: 'https://github.com/owner/repo/actions/runs/1', releaseRun: 'fixture' });
    assert.throws(() => tooling.publish(options), /simulated partial API outage/);
    assert.equal(refs.size, 2);
    assert.equal(releases.get('desktop-v1.6.1').draft, false);
    assert.equal(releases.get('mobile-v1.6.1').draft, true);
    assert.throws(() => tooling.publish(options), /Existing tags require resume/);
    failSecondPublication = false;
    const mutationCount = mutations.length;
    tooling.publish({ ...options, resume: true });
    assert.deepEqual(mutations.slice(mutationCount), [['public', 'mobile-v1.6.1']]);
    assert.equal(releases.get('mobile-v1.6.1').draft, false);
    const published = releases.get('desktop-v1.6.1').assets[0];
    assets.set(published.id, Buffer.from('changed public content'));
    const beforeConflict = mutations.length;
    assert.throws(() => tooling.publish({ ...options, resume: true }), /Existing asset differs/);
    assert.equal(mutations.length, beforeConflict, 'conflicts must not overwrite or republish anything');
});
