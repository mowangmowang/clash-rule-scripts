# AGENTS.md — Myscript collaboration conventions

## Runtime and synchronization

Four standalone Clash/Mihomo preprocessors implement `main(config)`. They are not
Node applications. Do not add runtime npm dependencies, `require`, ESM, real
subscription URLs, passwords or tokens. Preserve the filenames and LF endings.
Development tools and tests may use Node built-ins without installing npm packages.

Change the Chinese desktop script first and synchronize the English script:
behavior must be identical. Synchronize applicable changes to mobile and Bettbox
in the same commit. Mobile excludes Steam download and process rules, preserves
connectivity checks, longer health checks and supported icons. `ENABLE_IPV6`
defaults off. Desktop scripts use it for DNS only and preserve the input's
top-level `ipv6` (including absence); Clash Verge Settings owns that field.
Mobile and Bettbox still use the flag for both DNS and top-level IPv6.
Client DNS override can own DNS fields too; inspect the final running values.

Bettbox maintains `ruleOptionsEnable`, `serviceConfigs`, `knownGroupNames`, and
terminal fallbacks. Disabled groups must leave no dangling references or cycles.
Direct Stash JavaScript import is not supported. Do not claim unverified client
compatibility or imply that sniffing can decrypt ECH.

## Validation

Use Node 20 or newer:

```sh
node --test
node tools/core-check.cjs
node tools/provider-check.cjs
git diff --check
```

Also run `node --check` on all four `Clash*.js` scripts. Tests cover desktop parity,
precedence fixtures with provenance, input guards, isolation and Bettbox switches.
Native validation uses locked, checksummed Mihomo and geodata in a temporary
directory. Never use a real subscription or credentials in CI.

Client acceptance is required before merge and release: desktop reload,
Steam/Store/service routing, mobile reload, Bettbox disabled-group fallbacks,
WhatsApp initialization, IPv6 and HTTP/TLS sniffing. Record real versions and
exact script hashes in the PR using `docs/RELEASING.md`.
Never manufacture evidence or set `clients_verified` without actual results.

## Git and publication

- Origin: https://github.com/mowangmowang/clash-rule-scripts.git
- Use `fix/<description>` branches and PRs into main. Merge commits preserve
  focused Conventional Commits (`test`, `fix`, `docs`, `ci`, `chore`).
- Explicitly stage files; do not reset user work or force-push branches.
- Main requires `required-ci` from GitHub Actions, up-to-date branches and PRs.
  Administrators are subject to protection; a second reviewer is not required.
- After main CI and client acceptance, manually dispatch `release.yml` with the
  version, full main SHA, acceptance comment URL and verification confirmation.
- Desktop and mobile are independent release lines. Synchronized fixes publish
  two annotated tags on one SHA; Bettbox follows mobile.
- MAJOR changes incompatible structures; MINOR adds rules/groups; PATCH fixes
  behavior or ordering. Use complete versions such as `1.6.1`.
- Update script headers, bilingual README and both CHANGELOG sections. Commit
  CHANGELOG separately. Follow `docs/RELEASING.md` for publication and recovery.
- Never move published tags or overwrite released assets. Resume a partial
  publication at the same SHA; new code after publication requires a new version.
- Publication tooling can be repaired through a separate PR while resuming the
  original existing tags. This requires identical four script hashes, tag/ancestry
  checks and successful CI for both source and current tooling; see RELEASING.md.
- Remove the fix branch after successful release.
- Use pinned URLs for production and rollback: `@main` changes at PR merge,
  before a formal release.

## Files

The desktop pair is `Clash_script_v1.js` / `Clash_script_v1_en.js`.
Mobile is `Clash_script_mobile.js`; Bettbox is `ClashScript_ForBettbox.js`.
README files describe usage, CHANGELOG records versions, `docs/RELEASING.md`
specifies acceptance and recovery, and `tests/`, `tools/`, `.github/workflows/`
implement verification and publication.
