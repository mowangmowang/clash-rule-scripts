# Changelog

All notable changes to this project will be documented in this file.
Desktop and Mobile are independent release lines and are tagged separately.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `GitHub` proxy group (`select` type, `WARM` tier, upstream
  `standardProxies`, placed immediately after `Google Services`).
  Wired to the blackmatrix7 `GitHub.yaml` rule-set, covering
  github.com, githubusercontent.com, ghcr.io, npmjs.com,
  githubcopilot.com, atom.io and related domains. The Bettbox build
  exposes it as a visual toggle that falls back to `Fallback` when
  disabled.

## Mobile release line

### [mobile-v1.4] - 2026-08-04

### Added

- Dedicated `Telegram`, `Instagram` and `UHD` proxy groups (all
  `select` type, `WARM` tier, upstream `standardProxies`).
  - `RULE-SET,telegram` now targets `Telegram` (split out from
    `Social Media`).
  - `RULE-SET,instagram` now targets `Instagram` (split out from
    `Social Media`).
  - `DOMAIN-SUFFIX,uhdnow.com` now targets the new `UHD` group
    (previously hardcoded to `US - 美国`).
- `ClashScript_ForBettbox.js` — Bettbox (FlClash core) build derived
  from the mobile script. Adds visual per-group toggles via
  `ruleOptionsEnable`; a disabled group is not generated and rules
  targeting it are rewritten through the fallback chain defined in
  `serviceConfigs` (e.g. Telegram/Instagram -> `Social Media` ->
  `Fallback`; UHD -> `Foreign Media` -> `Fallback`). Group names
  are tracked in `knownGroupNames` so the proxy-reference cleaner
  keeps real node names and only drops references to disabled groups.

### Fixed

- UHD group icon pointed to a non-existent Qure asset
  (`Video.png`, 404); replaced with `ForeignMedia.png`.
- OpenCode group icon used `github.svg` (semantically wrong /
  missing from the Bettbox icon set); replaced with Qure
  `Stack.png`.

### Changed

- Common-section group order: `UHD` is placed immediately after
  `Foreign Media`, and `Telegram` / `Instagram` immediately after
  `Social Media`.
- `nameserver-policy` now routes `+.windows.net` and
  `+.msidentity.com` via `domesticNameservers` for mainland China
  CDN IPs (desktop CN/EN scripts).

### [mobile-v1.3] - 2026-06-30

### Added

- `OpenCode` proxy group (functional group, placed after `AI Overseas`,
  `select` type, `WARM` tier, health-check `https://opencode.ai`).
  Allows independently tuning proxy policy for the opencode terminal
  AI coding agent's own traffic.
- Routing rules (in the custom-correction block, before all
  `RULE-SET`s): `DOMAIN-SUFFIX,opencode.ai,OpenCode` and
  `DOMAIN-SUFFIX,anoma.ly,OpenCode`.
  - `opencode.ai` hosts the OpenCode Zen API gateway, OAuth login,
    session sharing and the documentation site — the unified entry
    point for opencode's own traffic.
  - `anoma.ly` is the parent-company domain (billing / help site).
  - BYOK traffic going directly to third-party LLMs
    (`api.openai.com`, `api.anthropic.com`, etc.) does NOT traverse
    this group; it remains governed by the existing `openai` rule-set,
    the `proxy` list and the `Fallback` group.
- `SG - 新加坡` and `TW - 台湾` regional proxy groups, auto-detected
  via regex on proxy names (same mechanism as the existing `HK - 香港`
  / `JP - 日本` / `US - 美国` groups).  Regex covers both simplified
  and traditional CJK (`台湾` / `臺灣` / `臺湾`) plus common English
  aliases, with `\b` guards on Latin alternatives to avoid substring
  false positives.
- `Others` proxy group (`select` type, includes all proxies via both
  an explicit `proxies` list and an `include-all: true` fallback) —
  aggregates non-mainstream regions (KR / DE / UK / etc.) so they can
  be referenced by functional groups and used effectively instead of
  being reachable only through the top-level `Select Node`.
- `regionalGroupNames` now includes `Others`, so every functional
  group (OpenCode, AI Overseas, Google Services, etc.) can select
  non-mainstream nodes as an upstream.

### Fixed

- `Others` proxy group rendered nodes twice in the panel. Root cause:
  the group set both `proxies: allProxies` (outbound proxy names) and
  `include-all: true` (which also injects all outbound proxies), so
  outbound nodes were injected via two overlapping paths. Fix: removed
  the explicit `proxies` list and rely solely on `include-all: true`,
  matching the `Select Node` group's proven pattern. All nodes still
  appear (now sorted by name, deduplicated); provider nodes continue
  to be injected by `include-all`.

### Changed

- Proxy group display order reorganised into common / uncommon
  sections. Common groups stay at the top: `Select Node` →
  mainstream regions (`HK - 香港` / `JP - 日本` / `US - 美国`) →
  functional groups (`Google Services` / `Foreign Media` /
  `Social Media` / `AI Overseas` / `OpenCode` / `Microsoft Services` /
  `Apple Services` / `Steam`) → `Fallback`. Uncommon groups are placed
  after `Fallback`: `Others` → `SG - 新加坡` → `TW - 台湾` →
  `Latency Test` → `Failover` → `Load Balance (Hash)` →
  `Load Balance (Round Robin)` → `Ad Block` → `Global Block`.
  Implementation: the `regionalGroups` array is now split into
  `mainstreamGroups` (HK/JP/US, inserted after `Select Node`) and
  `uncommonRegionalGroups` (SG/TW, inserted with `Others` after
  `Fallback` via `findIndex`). This is visual clustering only —
  reference relationships are unchanged (`Select Node` still lists
  `Latency Test` / `Failover` / regional groups as upstream,
  functional groups still reference all regions via
  `standardProxies`).

### [mobile-v1.2] - 2026-06-12

#### Added
- Microsoft services support (partial): Microsoft rule-set enabled,
  Microsoft Services proxy group, Bing follows the group (default
  DIRECT, switchable to proxy), Copilot pinned to AI Overseas.
- `name-server-policy`: `+.microsoft.com`, `+.office.com`,
  `+.office365.com`, `+.live.com`, `+.outlook.com` resolve via
  domestic DNS for mainland China CDN IPs.
- `fake-ip-filter`: `+.microsoft.com`, `+.live.com`,
  `+.mp.microsoft.com`, `+.microsoftonline.com`, `+.office.com` —
  bypasses fake-ip so Outlook mobile / OneDrive mobile / Microsoft
  Authenticator receive real IPs and don't trip the UWP-style
  "unreachable" probe that some Microsoft clients perform.

#### Fixed
- `Microsoft Services` proxy group had a duplicate `DIRECT` entry
  (one from the `standardProxies` array, one from the explicit
  prepended `["DIRECT", ...]`). Now filtered.

### [mobile-v1.1] - 2026-06-10

#### Fixed
- Apple HLS forced onto TCP: Chrome's QUIC attempts to `*.apple.com` and
  `itunes.apple.com` previously failed under proxy tunnels (VMess/Trojan
  UDP loss surfaced as `ERR_CONNECTION_CLOSED` for every chunk). Now
  blocked by `AND,((DOMAIN-SUFFIX,*.apple.com),(NETWORK,UDP)),REJECT`
  rules, mirroring the desktop v1.1 fix. Stash (iOS) supports AND +
  NETWORK since v3.0.2 (April 2025), so this is safe on both targets.

### [mobile-v1.0] - 2026-06-10

#### Added
- Initial release, derived from the desktop `v1.1` scripts.
- DNS injection: domestic + overseas DoH nameservers with policy routing.
- Proxy groups with regional auto-grouping and latency-based selection.
- Routing rules for advertising, private network, and geosite categories.
- Mobile-specific connectivity-check and captive-portal domains.
- IPv6 disabled by default; health-check intervals lengthened for battery.

#### Removed (relative to desktop v1.1)
- Steam CDN / download direct-connect rules.
- `applications` rule provider (process-name matching is unreliable on Android).

> Note: at the time of `mobile-v1.0`, the Apple HLS fix had only been
> applied to the desktop release line. The 2026-06-10 sync brings mobile
> into parity.

## Desktop release line

### [desktop-v1.4] - 2026-08-04

### Added

- Dedicated `Telegram`, `Instagram` and `UHD` proxy groups (all
  `select` type, `WARM` tier, upstream `standardProxies`).
  - `RULE-SET,telegram` now targets `Telegram` (split out from
    `Social Media`).
  - `RULE-SET,instagram` now targets `Instagram` (split out from
    `Social Media`).
  - `DOMAIN-SUFFIX,uhdnow.com` now targets the new `UHD` group
    (previously hardcoded to `US - 美国`).
- `ClashScript_ForBettbox.js` — Bettbox (FlClash core) build derived
  from the mobile script. Adds visual per-group toggles via
  `ruleOptionsEnable`; a disabled group is not generated and rules
  targeting it are rewritten through the fallback chain defined in
  `serviceConfigs` (e.g. Telegram/Instagram -> `Social Media` ->
  `Fallback`; UHD -> `Foreign Media` -> `Fallback`). Group names
  are tracked in `knownGroupNames` so the proxy-reference cleaner
  keeps real node names and only drops references to disabled groups.

### Fixed

- UHD group icon pointed to a non-existent Qure asset
  (`Video.png`, 404); replaced with `ForeignMedia.png`.
- OpenCode group icon used `github.svg` (semantically wrong /
  missing from the Bettbox icon set); replaced with Qure
  `Stack.png`.

### Changed

- Common-section group order: `UHD` is placed immediately after
  `Foreign Media`, and `Telegram` / `Instagram` immediately after
  `Social Media`.
- `nameserver-policy` now routes `+.windows.net` and
  `+.msidentity.com` via `domesticNameservers` for mainland China
  CDN IPs (desktop CN/EN scripts).

### [desktop-v1.3] - 2026-06-30

### Added

- `OpenCode` proxy group (functional group, placed after `AI Overseas`,
  `select` type, `WARM` tier, health-check `https://opencode.ai`).
  Allows independently tuning proxy policy for the opencode terminal
  AI coding agent's own traffic.
- Routing rules (in the custom-correction block, before all
  `RULE-SET`s): `DOMAIN-SUFFIX,opencode.ai,OpenCode` and
  `DOMAIN-SUFFIX,anoma.ly,OpenCode`.
  - `opencode.ai` hosts the OpenCode Zen API gateway, OAuth login,
    session sharing and the documentation site — the unified entry
    point for opencode's own traffic.
  - `anoma.ly` is the parent-company domain (billing / help site).
  - BYOK traffic going directly to third-party LLMs
    (`api.openai.com`, `api.anthropic.com`, etc.) does NOT traverse
    this group; it remains governed by the existing `openai` rule-set,
    the `proxy` list and the `Fallback` group.
- `SG - 新加坡` and `TW - 台湾` regional proxy groups, auto-detected
  via regex on proxy names (same mechanism as the existing `HK - 香港`
  / `JP - 日本` / `US - 美国` groups).  Regex covers both simplified
  and traditional CJK (`台湾` / `臺灣` / `臺湾`) plus common English
  aliases, with `\b` guards on Latin alternatives to avoid substring
  false positives.
- `Others` proxy group (`select` type, includes all proxies via both
  an explicit `proxies` list and an `include-all: true` fallback) —
  aggregates non-mainstream regions (KR / DE / UK / etc.) so they can
  be referenced by functional groups and used effectively instead of
  being reachable only through the top-level `Select Node`.
- `regionalGroupNames` now includes `Others`, so every functional
  group (OpenCode, AI Overseas, Google Services, etc.) can select
  non-mainstream nodes as an upstream.

### Fixed

- `Others` proxy group rendered nodes twice in the panel. Root cause:
  the group set both `proxies: allProxies` (outbound proxy names) and
  `include-all: true` (which also injects all outbound proxies), so
  outbound nodes were injected via two overlapping paths. Fix: removed
  the explicit `proxies` list and rely solely on `include-all: true`,
  matching the `Select Node` group's proven pattern. All nodes still
  appear (now sorted by name, deduplicated); provider nodes continue
  to be injected by `include-all`.

### Changed

- Proxy group display order reorganised into common / uncommon
  sections. Common groups stay at the top: `Select Node` →
  mainstream regions (`HK - 香港` / `JP - 日本` / `US - 美国`) →
  functional groups (`Google Services` / `Foreign Media` /
  `Social Media` / `AI Overseas` / `OpenCode` / `Microsoft Services` /
  `Apple Services` / `Steam`) → `Fallback`. Uncommon groups are placed
  after `Fallback`: `Others` → `SG - 新加坡` → `TW - 台湾` →
  `Latency Test` → `Failover` → `Load Balance (Hash)` →
  `Load Balance (Round Robin)` → `Ad Block` → `Global Block`.
  Implementation: the `regionalGroups` array is now split into
  `mainstreamGroups` (HK/JP/US, inserted after `Select Node`) and
  `uncommonRegionalGroups` (SG/TW, inserted with `Others` after
  `Fallback` via `findIndex`). This is visual clustering only —
  reference relationships are unchanged (`Select Node` still lists
  `Latency Test` / `Failover` / regional groups as upstream,
  functional groups still reference all regions via
  `standardProxies`).

### [desktop-v1.2] - 2026-06-12

#### Added
- Microsoft services support: BM7 `Microsoft` rule-set enabled,
  `Microsoft Services` proxy group (default DIRECT, switchable to
  proxy for users who want all Microsoft traffic via proxy), Bing
  follows the group, Copilot pinned to `AI Overseas`.
- Store / winget CDN rules (hardcoded `DOMAIN-SUFFIX` / `DOMAIN-KEYWORD`
  / `PROCESS-NAME` at the top of the rule list, before `RULE-SET`):
  `microsoftstore`, `onestore`, `apps.microsoft.com`,
  `assets.microsoft.com`, `onestore.ms`, `microsoftstore.com`,
  `events.data.microsoft.com`, `watson.microsoft.com`,
  `pipe.aria.microsoft.com`, `msn.com`,
  `storecatalogrevocation.storequality.microsoft.com`,
  `windowssearch.com`, `mp.microsoft.com`, `delivery.mp.microsoft.com`,
  `winget.microsoft.com`, plus `WinStore.App.exe`,
  `Microsoft.StorePurchaseApp.exe`, `Microsoft.WindowsStore*`
  process-name fallbacks.
- Login / auth rules: `login.live.com`, `login.windows.net`,
  `account.live.com`.
- Windows Update rules: `download.windowsupdate.com`,
  `download.microsoft.com`, `officecdn.microsoft.com`, `wns.windows.com`.
- `nameserver-policy` entries for Microsoft CDN domains so they
  resolve via domestic DNS (mainland China CDN IPs):
  `+.microsoft.com`, `+.microsoftonline.com`, `+.msauth.net`,
  `+.azure.com`, `+.office.com`, `+.office365.com`, `+.live.com`,
  `+.outlook.com`, `+.windowsupdate.com`, `+.mp.microsoft.com`.
- `profile.store-selected: true` and `profile.store-fake-ip: true`
  for persistence across restarts.

#### Fixed
- **Microsoft Store `0x800704cf` "no internet" error under fake-ip**
  (root-cause fix). The Store UWP process (`WinStore.App.exe`,
  `StorePurchaseApp.exe`) received `198.18.x.x` synthetic IPs from
  fake-ip mode. An internal WinHTTP connectivity probe flagged this
  range as unreachable and aborted, surfacing in the Store as
  `0x800704cf` (Win32 `ERROR_NETWORK_UNREACHABLE`). Loopback
  exemption alone (`CheckNetIsolation.exe LoopbackExempt -a`) did
  not resolve it. Fix: added `+.microsoft.com`, `+.live.com`,
  `+.mp.microsoft.com`, `+.microsoftstore.com`, `+.onestore.ms` to
  `fake-ip-filter` so those domains resolve to real IPs. Sniffer
  still recovers the SNI from the TLS Client Hello, so existing
  `DOMAIN-SUFFIX` / `PROCESS-NAME` / `RULE-SET,microsoft` rules
  match and route DIRECT as before.
- "Microsoft Store failed to initialize" errors: Store backends
  (`onestore`, `microsoftstore`, `apps.microsoft.com`,
  `assets.microsoft.com`, `events.data`, `watson`, `pipe.aria`,
  `msn`, `windowssearch`, `storecatalogrevocation`) were routed
  through the `Microsoft Services` proxy group, but the WebSocket /
  SSE real-time connections got interrupted by the group dispatch.
  Hardcoded `DIRECT` rules at the top now bypass the group for
  these domains.
- `Microsoft Services` proxy group had a duplicate `DIRECT` entry
  (one from `standardProxies`, one from the explicit prepended
  `["DIRECT", ...]`). Now filtered with
  `...standardProxies.filter(p => p !== "DIRECT")`.
- `+.bing.com` removed from `nameserver-policy` so Bing follows
  the `Microsoft Services` proxy group (default DIRECT, switchable
  to proxy) instead of being hardcoded to domestic DNS resolution.

### [desktop-v1.1] - 2026-06-10

#### Changed
- `nameserver-policy`: Steam CDN entries now precede `geosite:geolocation-!cn`,
  so `steamcontent.com` and peers resolve via domestic DNS and return
  reachable domestic Akamai IPs.
- `fake-ip-filter`: explicit doc-level note that Steam CDN domains MUST
  NOT be added to this list (returning a real IP bypasses the DOMAIN
  rule chain and breaks direct-connect).

#### Fixed
- Steam downloads previously returned 0 bps under fake-ip mode due to
  the nameserver ordering bug above.
- Apple HLS forced onto TCP: Chrome's QUIC attempts to `*.apple.com` and
  `itunes.apple.com` previously failed under proxy tunnels (VMess/Trojan
  UDP loss surfaced as `ERR_CONNECTION_CLOSED` for every chunk). Now
  blocked by `AND,((DOMAIN-SUFFIX,*.apple.com),(NETWORK,UDP)),REJECT`.

[Unreleased]: https://github.com/mowangmowang/clash-rule-scripts/compare/desktop-v1.4...HEAD
[mobile-v1.4]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.4
[mobile-v1.3]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.3
[mobile-v1.2]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.2
[mobile-v1.1]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.1
[mobile-v1.0]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.0
[desktop-v1.4]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/desktop-v1.4
[desktop-v1.3]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/desktop-v1.3
[desktop-v1.2]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/desktop-v1.2
[desktop-v1.1]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/desktop-v1.1
