# Validation and manual release

Runtime files are standalone `main(config)` preprocessors. Development tools use
Node 20 built-ins only. A successful native parse does not prove client routing.

## Fix branch and CI

1. Fetch main and tags; inspect changes before creating `fix/<description>`.
2. Commit regression tests, synchronized fixes, documentation, CI, version metadata,
   and CHANGELOG as focused commits. Never overwrite user changes or existing tags.
3. Run `node --test`, syntax checks on four runtime files, `node tools/core-check.cjs`,
   `node tools/provider-check.cjs`, and `git diff --check`.
4. Push the fix branch and open a PR into main. The `required-ci` check must pass.
   Configure protection after its first successful run, using its actual check name
   and GitHub Actions app ID: strict status checks, required PR, zero required
   approvals, enforce administrators, forbid force pushes and branch deletion.
5. Record real client acceptance below. Merge by merge commit only after all checks
   and client acceptance. Wait for the exact merged main SHA's push CI to succeed.

CI uses fixed local rule providers and immutable, SHA256-verified Mihomo v1.19.15
and geodata, locked in `tools/toolchain-lock.json`. Both inline and provider-only
inputs are parsed for all scripts. Release preflight downloads all actual providers,
checks fixtures against their pinned source commits, and repeats native parsing.
Reports contain only fake `example.com` nodes with `fixture-only` passwords.
Downloads/configurations stay in OS temporary directories; reports are ignored.

## Client acceptance

Use the scripts from the PR commit, and calculate exact hashes:

```powershell
Get-FileHash Clash_script_v1.js,Clash_script_v1_en.js,Clash_script_mobile.js,ClashScript_ForBettbox.js -Algorithm SHA256
```

For desktop Clash Verge v2.5.6, back up the current global preprocessing script.
Paste the new desktop script into the subscription's script preprocessing editor
(the exact menu label depends on the build), apply it and reload the subscription.
Inspect the generated runtime configuration as well as client logs and connections:

- Reload succeeds with no missing provider or invalid configuration error.
- Start a Steam download: download CDN requests select DIRECT and transfer data.
- Open Microsoft Store; its matching process uses DIRECT. Select another policy in
  Microsoft Services and confirm `1drv.ms`, `aka.ms`, and Bing follow that group;
  Copilot continues through AI Overseas.
- Instagram connections select Instagram before Facebook; verify ad subdomains
  `caclick.baidu.com`, `mobads.baidu.com`, and `kepler.jd.com` hit blocking rules,
  while normal Baidu/JD pages work through DIRECT.
- DNS and top-level IPv6 settings are false. Use a fresh uncached AAAA query
  through the client's configured DNS listener and confirm no IPv6 result.
  Desktop `ENABLE_IPV6` controls DNS only; the script preserves the input's
  top-level `ipv6`, including its absence. In Clash Verge v2.5.6, top-level IPv6
  is app-owned and conflicting script writes are discarded. Disable the separate
  Settings → Clash Settings → IPv6 switch, reload and check the actual running
  configuration/API. Check that a fresh reload produces no `ipv6` discarded-field
  notice. The IPv6 switch inside DNS override controls `dns.ipv6` instead; enabling
  DNS override can make the client own DNS fields as well. Inspect both final
  values before marking acceptance passed.
  [Clash Verge ownership implementation](https://github.com/clash-verge-rev/clash-verge-rev/blob/v2.5.6/src-tauri/src/enhance/mod.rs#L285)
- With debug logs temporarily enabled, visit HTTP and TLS sites in configured
  ports and inspect sniffed domains. Confirm platform skip domains are preserved.
  QUIC remains affected by existing blocking rules; sniffing does not decrypt ECH.
- Test the English desktop file too; record both tested hashes.

For Bettbox, install its matching script and reload. Confirm Whatsapp provider
initializes without 404. Disable Instagram, then Instagram plus Social Media, and
verify fallback is respectively Social Media and Fallback; restore preferences.
Verify IPv6, sniffing, and mobile skip domains on the actual client.

For the ordinary mobile script, use a client that really supports this JavaScript
preprocessor and the emitted Mihomo fields, and record its exact name/version.
Check reload, IPv6, sniffing and skip domains. Stash `.stoverride` is a different
YAML interface; this release does not claim direct Stash JavaScript compatibility.

A maintainer posts an issue comment on the PR with the marker and JSON below.
Replace placeholders, paste lowercase hashes, and set checks to true **only after
the corresponding actual test passes**. Leave pending checks false. Add test
details, date, screenshots/log extracts without subscription secrets below JSON.
This is an example schema, not evidence of performed tests:

<!-- The literal marker inside the code block is consumed by release.cjs. -->
````text
<!-- myscript-client-acceptance -->
```json
{
  "version": "1.6.1",
  "files": {
    "Clash_script_v1.js": "SHA256",
    "Clash_script_v1_en.js": "SHA256",
    "Clash_script_mobile.js": "SHA256",
    "ClashScript_ForBettbox.js": "SHA256"
  },
  "clients": {
    "desktop": { "name": "Clash Verge", "version": "2.5.6", "checks": {
      "reload": false, "steam": false, "store": false, "microsoft": false,
      "instagram": false, "ipv6": false, "sniffer": false, "skipDomains": false
    } },
    "bettbox": { "name": "Bettbox", "version": "ACTUAL VERSION", "checks": {
      "reload": false, "whatsapp": false, "fallbacks": false,
      "ipv6": false, "sniffer": false, "skipDomains": false
    } },
    "mobile": { "name": "ACTUAL CLIENT", "version": "ACTUAL VERSION", "checks": {
      "reload": false, "ipv6": false, "sniffer": false, "skipDomains": false
    } }
  }
}
```
````

If any script changes, update hashes and repeat affected acceptance. Without access
to required clients, keep the PR open; do not merge or trigger publication.

## Dispatch and inspect CD

From the main branch workflow, dispatch `release.yml` with full stable `version`,
the complete current main `target_sha`, `clients_verified=true`, the exact PR
comment `evidence_url`, and `resume=false`. Example after acceptance and merge:

```powershell
$releaseSha = git rev-parse HEAD
gh workflow run release.yml --ref main -f version=1.6.1 -f target_sha=$releaseSha -f clients_verified=true -f evidence_url='https://github.com/OWNER/REPO/pull/NUMBER#issuecomment-ID' -f resume=false
```

The workflow checks current main, the merged PR, maintainer-authored acceptance,
four hashes, metadata, and successful main CI. It repeats all CI and live provider
tests with read permissions. The single publication job gets `contents: write`,
rechecks main/evidence/package hashes, and atomically pushes the two annotated tags.
It creates both Releases as drafts, uploads separate script pairs and SHA256SUMS,
downloads to compare every byte, then publishes and downloads again. Release notes
record commit, main CI, CD run and client evidence. No PAT is required.

Tags and Releases are handled in one run because token-generated pushes do not
trigger a new push workflow ([GitHub documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
Publishing the two Releases is not an atomic API operation; resume handles a failure
between publishing the first and second.

After CD success, fetch tags and compare both `^{commit}` values to target_sha.
Download Releases and validate checksums. Confirm raw tag URLs and pinned CDN URLs
return the expected version. Then remove the remote and local fix branch and sync
main. `@main` links update when the PR merges, before version publication.

## Recovery

- Validation failure: no publication; repair through a fresh PR if already merged.
- Atomic push failure: inspect remote tags. Never force push or move a tag.
- Both tags exist at the same exact commit and have the expected annotation:
  dispatch identical version/SHA/evidence with `resume=true`. Existing asset bytes
  must match; missing assets may be added only to draft Releases. Published assets
  are never replaced. A single preexisting tag or conflicting asset stops the run.
- Draft releases are found through the paginated release list and refreshed by
  release ID. The tag lookup endpoint only supports published releases; do not use
  it to read a newly created draft. Duplicate releases for a tag stop publication.
  [GitHub release API](https://docs.github.com/en/rest/releases/releases)
- If publication tooling itself needs repair, use a new fix branch and PR, wait
  for its main CI, then resume from the current main workflow with the original
  immutable tag SHA and acceptance comment. This narrow recovery requires both
  matching annotated tags, the original target to be an ancestor of current main,
  all four current scripts to be byte-identical to the target, and successful push
  CI for both target and current tooling SHA. Packaging and publication recheck the
  current main SHA; any script, tag, evidence or package conflict stops recovery.
  The verification job parses the original target; current main CI also tests the
  repaired publication code. Tags and release commit remain the original target.
- If one Release is public, keep it and resume the other. Changed script bytes
  cannot use this recovery path; investigate and use a new patch version.
- Public code bug: open a new fix branch and publish the next patch version. Revert
  main through a PR if needed; leave historical tags intact.
