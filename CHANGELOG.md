# Changelog

All notable changes to this project will be documented in this file.
Desktop and Mobile are independent release lines and are tagged separately.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## Mobile release line

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

### [mobile-v1.1] - 2026-06-10

#### Fixed
- Apple HLS forced onto TCP: Chrome's QUIC attempts to `*.apple.com` and
  `itunes.apple.com` previously failed under proxy tunnels (VMess/Trojan
  UDP loss surfaced as `ERR_CONNECTION_CLOSED` for every chunk). Now
  blocked by `AND,((DOMAIN-SUFFIX,*.apple.com),(NETWORK,UDP)),REJECT`
  rules, mirroring the desktop v1.1 fix. Stash (iOS) supports AND +
  NETWORK since v3.0.2 (April 2025), so this is safe on both targets.

> Note: at the time of `mobile-v1.0`, the Apple HLS fix had only been
> applied to the desktop release line. The 2026-06-10 sync brings mobile
> into parity.

## Desktop release line

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

[Unreleased]: https://github.com/mowangmowang/clash-rule-scripts/compare/desktop-v1.1...HEAD
[mobile-v1.0]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.0
[mobile-v1.1]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/mobile-v1.1
[desktop-v1.1]: https://github.com/mowangmowang/clash-rule-scripts/releases/tag/desktop-v1.1
