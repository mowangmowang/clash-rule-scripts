# Changelog

All notable changes to this project will be documented in this file.
Desktop and Mobile are independent release lines and are tagged separately.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## Mobile release line

### [mobile-v1.0] - 2026-06-08

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
- All `icon` properties on proxy groups.

## Desktop release line

### [desktop-v1.1] - 2026-06-08

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

[Unreleased]: https://example.invalid/compare/desktop-v1.1...HEAD
[mobile-v1.0]: https://example.invalid/releases/tag/mobile-v1.0
[desktop-v1.1]: https://example.invalid/releases/tag/desktop-v1.1
