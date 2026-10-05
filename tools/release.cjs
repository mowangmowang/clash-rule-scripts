'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root, scripts } = require('../tests/helpers.cjs');
const { hash } = require('./core-check.cjs');

const clientChecks = {
    desktop: ['reload', 'steam', 'store', 'microsoft', 'instagram', 'ipv6', 'sniffer', 'skipDomains'],
    bettbox: ['reload', 'whatsapp', 'fallbacks', 'ipv6', 'sniffer', 'skipDomains'],
    mobile: ['reload', 'ipv6', 'sniffer', 'skipDomains']
};
function ensure(condition, message) { if (!condition) throw new Error(message); }
function command(binary, args) {
    const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', timeout: 120000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${binary} ${args[0]} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
}
function api(endpoint) { return JSON.parse(command('gh', ['api', endpoint])); }
function maybeApi(endpoint) {
    try { return api(endpoint); } catch (error) { if (/HTTP 404/.test(error.message)) return null; throw error; }
}
function inputs(env = process.env) {
    ensure(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(env.RELEASE_VERSION || ''), 'Version must be full stable semver');
    ensure(/^[a-f0-9]{40}$/.test(env.TARGET_SHA || ''), 'target_sha must be a full commit SHA');
    ensure(env.CLIENTS_VERIFIED === 'true', 'Real client verification is required');
    ensure(['true', 'false'].includes(env.RELEASE_RESUME), 'resume must be true or false');
    ensure(env.GITHUB_REF === 'refs/heads/main', 'Dispatch release from main only');
    ensure(/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || ''), 'Missing repository');
    return { version: env.RELEASE_VERSION, sha: env.TARGET_SHA, repo: env.GITHUB_REPOSITORY,
        evidenceUrl: env.EVIDENCE_URL, resume: env.RELEASE_RESUME === 'true' };
}
function evidenceLocation(url, repo) {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)$/);
    ensure(parsed.origin === 'https://github.com' && !parsed.search && match && match[1] === repo &&
        /^#issuecomment-\d+$/.test(parsed.hash), 'Evidence must be an issue-comment URL on a PR in this repository');
    return { pr: Number(match[2]), comment: parsed.hash.slice('#issuecomment-'.length) };
}
function validateEvidence(record, options, hashes, association) {
    ensure(['OWNER', 'MEMBER', 'COLLABORATOR'].includes(association), 'Acceptance must be recorded by a repository maintainer');
    ensure(record.version === options.version, 'Acceptance version mismatch');
    for (const file of scripts) ensure(record.files?.[file] === hashes[file], `Acceptance hash mismatch: ${file}`);
    for (const [kind, checks] of Object.entries(clientChecks)) {
        const client = record.clients?.[kind];
        ensure(typeof client?.name === 'string' && client.name.trim() && typeof client.version === 'string' &&
            client.version.trim(), `Missing real ${kind} client and version`);
        for (const check of checks) ensure(client.checks?.[check] === true, `${kind}.${check} has not passed`);
    }
}
function scriptHashes(version) {
    const hashes = {};
    for (const file of scripts) {
        const data = fs.readFileSync(path.join(root, file));
        const source = data.toString('utf8');
        ensure(source.match(/@version\s+([^\s]+)/)?.[1] === version, `Wrong @version: ${file}`);
        ensure(!source.includes('\r'), `Non-LF script: ${file}`);
        if (file === 'ClashScript_ForBettbox.js') ensure(source.match(/@basedon\s+Clash_script_mobile\.js\s+v([^\s]+)/)?.[1] === version, 'Wrong Bettbox @basedon');
        hashes[file] = hash(data);
    }
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    for (const line of ['desktop', 'mobile']) ensure(changelog.includes(`### [${line}-v${version}]`), 'Missing changelog release section');
    for (const file of ['README.md', 'README_EN.md']) ensure(fs.readFileSync(path.join(root, file), 'utf8').includes(`desktop-v${version}`), `Wrong pinned version: ${file}`);
    return hashes;
}
function preflight(options) {
    command('git', ['fetch', 'origin', 'main', '--tags']);
    ensure(command('git', ['rev-parse', 'origin/main']) === options.sha, 'target_sha is no longer current main');
    ensure(command('git', ['rev-parse', 'HEAD']) === options.sha, 'Checked-out commit differs from target');
    const hashes = scriptHashes(options.version);
    const location = evidenceLocation(options.evidenceUrl, options.repo);
    const comment = api(`repos/${options.repo}/issues/comments/${location.comment}`);
    ensure(comment.issue_url.endsWith(`/issues/${location.pr}`), 'Comment belongs to a different PR');
    const fenced = comment.body.match(/<!-- myscript-client-acceptance -->\s*```json\s*([\s\S]*?)```/);
    ensure(fenced, 'Missing client acceptance JSON marker');
    validateEvidence(JSON.parse(fenced[1]), options, hashes, comment.author_association);
    const pr = api(`repos/${options.repo}/pulls/${location.pr}`);
    ensure(pr.merged && pr.base.ref === 'main' && pr.base.repo.full_name === options.repo &&
        pr.merge_commit_sha === options.sha, 'Acceptance PR must be merged into this exact main commit');
    const runs = api(`repos/${options.repo}/actions/workflows/syntax-check.yml/runs?branch=main&event=push&head_sha=${options.sha}&per_page=100`).workflow_runs;
    // A later failed rerun must not be hidden by an older successful run.
    const run = runs.filter(item => item.head_sha === options.sha).sort((a, b) => b.id - a.id)[0];
    ensure(run && run.status === 'completed' && run.conclusion === 'success', 'Latest main CI at target SHA must pass');
    return { ...options, hashes, validationUrl: run.html_url,
        releaseRun: process.env.GITHUB_RUN_ID ? `https://github.com/${options.repo}/actions/runs/${process.env.GITHUB_RUN_ID}` : null };
}
function packageRelease(manifest) {
    const directory = path.join(root, 'release-artifacts');
    fs.mkdirSync(directory, { recursive: true });
    for (const file of scripts) fs.copyFileSync(path.join(root, file), path.join(directory, file));
    for (const [line, files] of [['desktop', scripts.slice(0, 2)], ['mobile', scripts.slice(2)]]) {
        fs.writeFileSync(path.join(directory, `${line}-SHA256SUMS.txt`), files.map(file => `${manifest.hashes[file]}  ${file}\n`).join(''));
    }
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
function validateTag(tag, object, options, line) {
    ensure(object?.object?.type === 'tag', `Tag is not annotated: ${tag}`);
    const detail = api(`repos/${options.repo}/git/tags/${object.object.sha}`);
    validateTagDetail(tag, detail, options, line);
}
function validateTagDetail(tag, detail, options, line) {
    ensure(detail?.tag === tag && detail.object?.type === 'commit' && detail.object.sha === options.sha &&
        detail.message?.trim() === `${line} v${options.version}: configuration and routing hardening`, `Conflicting immutable tag: ${tag}`);
}
function tagMode(existing, resume) {
    ensure(!existing.some(Boolean) || (resume && existing.every(Boolean)), 'Existing tags require resume and both matching tags');
    return existing.every(Boolean) ? 'reuse' : 'create';
}
function releaseNotes(manifest, line) {
    return `# ${line} v${manifest.version}\n\n` +
        '- Correct IPv6 defaults and configure HTTP/TLS/QUIC sniffing explicitly.\n' +
        '- Restore Instagram, Microsoft and advertising/privacy rule precedence.\n' +
        '- Validate subscription inputs and isolate generated data between calls.\n' +
        (line === 'Desktop' ? '- Fix the Windows Store process regex.\n' : '- Preserve Bettbox group switches and fallback chains.\n') +
        '- Correct client compatibility and add behavioral/native CI with guarded manual publication.\n' +
        '- Preserve SpanishDict routing and the corrected Whatsapp provider URL.\n\n' +
        `Commit: ${manifest.sha}\n\nClient acceptance: ${manifest.evidenceUrl}\n\n` +
        `Validation: ${manifest.validationUrl}\n\nRelease run: ${manifest.releaseRun}\n`;
}
function assetPlan(manifest, line) {
    const files = line === 'desktop' ? scripts.slice(0, 2) : scripts.slice(2);
    return [...files, `${line}-SHA256SUMS.txt`];
}
function compareReleaseAssets(release, manifest, line, uploadMissing) {
    const directory = path.join(root, 'release-artifacts');
    const names = assetPlan(manifest, line);
    ensure(release.assets.every(asset => names.includes(asset.name)), 'Unexpected existing release asset');
    for (const name of names) {
        const expected = fs.readFileSync(path.join(directory, name));
        const asset = release.assets.find(item => item.name === name);
        if (asset) {
            // API redirects public downloads; use gh to authenticate draft assets as well.
            const result = spawnSync('gh', ['api', `repos/${manifest.repo}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream'],
                { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
            ensure(!result.error && result.status === 0 && hash(result.stdout) === hash(expected), `Existing asset differs: ${name}`);
        } else {
            ensure(uploadMissing && release.draft, `Missing published asset: ${name}`);
            command('gh', ['release', 'upload', release.tag_name, path.join(directory, name), '--repo', manifest.repo]);
        }
    }
}
function publish(options) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release-artifacts', 'manifest.json'), 'utf8'));
    const fresh = preflight(options); // Recheck main and real acceptance immediately before tagging.
    ensure(manifest.sha === fresh.sha && manifest.version === fresh.version && manifest.repo === fresh.repo &&
        manifest.evidenceUrl === fresh.evidenceUrl, 'Stale packaging manifest');
    for (const file of scripts) ensure(manifest.hashes[file] === fresh.hashes[file] &&
        hash(fs.readFileSync(path.join(root, 'release-artifacts', file))) === fresh.hashes[file], `Packaged file changed: ${file}`);
    for (const line of ['desktop', 'mobile']) {
        const expected = assetPlan(manifest, line).slice(0, 2).map(file => `${fresh.hashes[file]}  ${file}\n`).join('');
        ensure(fs.readFileSync(path.join(root, 'release-artifacts', `${line}-SHA256SUMS.txt`), 'utf8') === expected, 'Packaged checksum list changed');
    }
    const tags = ['desktop', 'mobile'].map(line => `${line}-v${options.version}`);
    const existing = tags.map(tag => maybeApi(`repos/${options.repo}/git/ref/tags/${tag}`));
    if (tagMode(existing, options.resume) === 'reuse') tags.forEach((tag, index) => validateTag(tag, existing[index], options, index === 0 ? 'Desktop' : 'Mobile'));
    else {
        command('git', ['config', 'user.name', 'github-actions[bot]']);
        command('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
        for (let i = 0; i < tags.length; i++) command('git', ['tag', '-a', tags[i], options.sha, '-m',
            `${i === 0 ? 'Desktop' : 'Mobile'} v${options.version}: configuration and routing hardening`]);
        command('git', ['push', '--atomic', 'origin', ...tags]);
    }
    const releases = [];
    for (const line of ['desktop', 'mobile']) {
        const tag = `${line}-v${options.version}`;
        const title = `${line === 'desktop' ? 'Desktop' : 'Mobile'} v${options.version}`;
        let release = maybeApi(`repos/${options.repo}/releases/tags/${tag}`);
        if (release) {
            ensure(options.resume && release.name === title && release.target_commitish === options.sha &&
                release.body.includes(`Commit: ${options.sha}`) && release.body.includes(`Client acceptance: ${options.evidenceUrl}`), 'Conflicting existing release');
        } else {
            const notes = path.join(root, 'release-artifacts', `${line}-notes.md`);
            fs.writeFileSync(notes, releaseNotes(manifest, line === 'desktop' ? 'Desktop' : 'Mobile'));
            command('gh', ['release', 'create', tag, '--draft', '--verify-tag', '--target', options.sha,
                '--repo', options.repo, '--title', title, '--notes-file', notes]);
            release = api(`repos/${options.repo}/releases/tags/${tag}`);
        }
        compareReleaseAssets(release, manifest, line, true);
        const complete = api(`repos/${options.repo}/releases/tags/${tag}`);
        compareReleaseAssets(complete, manifest, line, false);
        releases.push(complete);
    }
    for (const release of releases) if (release.draft) command('gh', ['release', 'edit', release.tag_name, '--draft=false', '--repo', options.repo]);
    for (const line of ['desktop', 'mobile']) {
        const tag = `${line}-v${options.version}`;
        validateTag(tag, api(`repos/${options.repo}/git/ref/tags/${tag}`), options, line === 'desktop' ? 'Desktop' : 'Mobile');
        const release = api(`repos/${options.repo}/releases/tags/${tag}`);
        ensure(!release.draft && !release.prerelease, 'Release is not public and stable');
        compareReleaseAssets(release, manifest, line, false);
        console.log(`Published and downloaded successfully: ${release.html_url}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `## Release ${options.version}\n\nCommit: ${options.sha}\n\nAcceptance: ${options.evidenceUrl}\n\nBoth annotated tags and all four downloadable script hashes verified.\n`);
}
module.exports = { inputs, evidenceLocation, validateEvidence, clientChecks, scriptHashes, tagMode, validateTagDetail, packageRelease, publish };
if (require.main === module) {
    try {
        const options = inputs();
        if (process.argv[2] === 'package') packageRelease(preflight(options));
        else if (process.argv[2] === 'publish') publish(options);
        else if (process.argv[2] === 'validate') {
            ensure(api(`repos/${options.repo}/git/ref/heads/main`).object.sha === options.sha, 'Target is not current main');
            ensure(command('git', ['rev-parse', 'HEAD']) === options.sha, 'Dispatch commit differs from main target');
        } else throw new Error('Use validate, package or publish');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
