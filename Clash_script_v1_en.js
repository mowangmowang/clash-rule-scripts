/**
 * Clash Verge Rev — Main Configuration Script (main.js)
 *
 * @version  1.1
 * @date     2026-06-10
 *
 * How it works
 * ────────────
 * This file is a JavaScript preprocessor invoked by Clash Verge Rev's
 * "config preprocessing" feature. The main(config) function receives the
 * raw configuration from the subscription source (subscribe.yaml) as a
 * parameter, enriches and overrides it, then returns the final config
 * object. Custom rules survive subscription updates because they are
 * injected at runtime rather than written into the subscription file.
 *
 * Three core principles for Steam direct-connect under fake-ip mode
 * ─────────────────────────────────────────────────────────────────
 * 1. Rule list is evaluated top-to-bottom, first match wins.
 *    Steam DIRECT rules MUST appear before the advertising rule sets.
 *
 * 2. Steam CDN domains MUST NOT be added to fake-ip-filter.
 *    If added, Clash returns a real IP and the DOMAIN rule chain is
 *    bypassed — the connection falls through to MATCH (proxied) and
 *    may receive an overseas CDN node IP, resulting in 0 bps.
 *
 * 3. Steam CDN entries in nameserver-policy MUST precede
 *    geosite:geolocation-!cn.  Otherwise steamcontent.com and peers
 *    resolve via foreign DNS, returning overseas Akamai IPs that are
 *    unreachable via DIRECT from mainland China.
 */

// ============================================================
//  1.  DNS Server Definitions
// ============================================================

/**
 * Domestic DoH (DNS over HTTPS) servers.
 * Used for domestic domains and Steam CDN domains (to obtain
 * mainland China CDN node IPs).  Selected for stability, low
 * latency, and absence of DNS poisoning.
 */
const domesticNameservers = [
    "https://dns.alidns.com/dns-query",  // Alibaba Cloud public DNS
    "https://doh.pub/dns-query",          // Tencent DNSPod
    "https://doh.360.cn/dns-query"        // 360 Secure DNS
];

/**
 * Foreign DoH servers.
 * Used for domains subject to GFW DNS poisoning (Google, YouTube,
 * Telegram, etc.).  These servers themselves must be reachable
 * through a proxy, which proxy-server-nameserver handles.
 */
const foreignNameservers = [
    "https://1.1.1.1/dns-query",          // Cloudflare  (primary)
    "https://1.0.0.1/dns-query",          // Cloudflare  (secondary)
    "https://208.67.222.222/dns-query",   // OpenDNS     (primary)
    "https://208.67.220.220/dns-query",   // OpenDNS     (secondary)
    "https://194.242.2.2/dns-query",      // Mullvad     (primary)
    "https://194.242.2.3/dns-query"       // Mullvad     (secondary)
];

// ============================================================
//  2.  Full DNS Configuration
// ============================================================

const DNS_LISTEN   = "0.0.0.0:1053";
// [2026-06-09 fix] Windows web Apple Music ERR_CONNECTION_CLOSED:
// browsers issue A + AAAA in parallel for *.apple.com; Akamai v6 edges
// frequently RST chunk requests, surfacing as ERR_CONNECTION_CLOSED.
// Mobile script already forces v4-only — align the desktop script.
const DISABLE_IPV6 = true;

const dnsConfig = {
    "enable": true,
    "listen": DNS_LISTEN,

    /**
     * Disable IPv6.
     *
     * IPv6 routing is unreliable on many networks, causing
     * connection timeouts or outright failures.  Dual-stack
     * services (Steam, Apple, etc.) may prefer IPv6 and fail
     * silently.  Set DISABLE_IPV6 to true on IPv6-only
     * networks or DNS breaks entirely.
     */
    "ipv6": DISABLE_IPV6,

    "use-system-hosts": false,
    "cache-algorithm":  "arc",

    /**
     * enhanced-mode: fake-ip
     *
     * How it works
     *   - When a client queries any domain, Clash immediately
     *     returns a fake IP from the 198.18.x.x range.
     *   - The client connects to the fake IP → Clash intercepts →
     *     looks up the real domain from its internal table.
     *   - Clash applies routing rules to the real domain.
     *   - If the rule says DIRECT, Clash resolves the true IP via
     *     nameserver-policy and connects directly.
     *
     * Benefit: near-instant DNS resolution, low connection latency.
     */
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",

    /**
     * fake-ip-filter
     *
     * Domains listed here bypass fake-ip and receive real IPs.
     *
     * CRITICAL: Steam CDN domains must never appear in this list.
     * When a Steam client gets a real IP and connects directly,
     * the traffic is IP-layer only — Clash's DOMAIN rules
     * (DOMAIN-SUFFIX / DOMAIN-KEYWORD) cannot match.  Traffic
     * falls through to the MATCH rule (proxied) and may connect
     * to an overseas Akamai node, yielding 0 bps.
     */
    "fake-ip-filter": [
        // Local / LAN (prevent fake-ip from breaking mDNS etc.)
        "+.lan",
        "+.local",

        // Windows Network Connectivity Status Indicator
        // (fixes the "globe" icon on the taskbar)
        "+.msftconnecttest.com",
        "+.msftncsi.com",

        // QQ quick-login detection (fake-ip breaks local login)
        "localhost.ptlogin2.qq.com",
        "localhost.sec.qq.com",

        // WeChat Work quick-login detection (same reason)
        "localhost.work.weixin.qq.com",
    ],

    /**
     * default-nameserver — plain IPs only, no hostnames.
     *
     * These IPs are used for bootstrapping: when the DoH server
     * hostnames themselves need to be resolved (cold start),
     * plain IPs avoid a chicken-and-egg deadlock.
     * A mix of domestic + foreign ensures DoH hostnames in both
     * regions can be resolved.
     */
    "default-nameserver": ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],

    // Default upstream: domestic DNS.  nameserver-policy overrides
    // for specific domains below.
    "nameserver": domesticNameservers,

    // Resolves proxy-provider hostnames (subscription node domains).
    // Must use DNS reachable in mainland China.
    "proxy-server-nameserver": domesticNameservers,

    /**
     * nameserver-policy — per-domain DNS server assignment.
     *
     * Keys are evaluated top-to-bottom; first match wins (same
     * semantics as routing rules).  Order is significant.
     *
     * Steam direct-connect DNS strategy
     *
     * Steam download CDNs (steamcontent.com, *.akamaized.net, …)
     * are foreign domains.  Without an explicit policy, they match
     * the catch-all geosite:geolocation-!cn below and resolve via
     * foreign DNS → 1.1.1.1 returns US/EU Akamai IPs → DIRECT from
     * mainland China to those IPs = 0 bps.
     *
     * By placing Steam CDN entries first, they are forced to resolve
     * via domestic DNS → mainland China Akamai CDN node IPs → fast
     * DIRECT download, matching the behaviour of subscribe.yaml
     * (which has no DNS config and simply relies on the system's
     * domestic DNS).
     */
    "nameserver-policy": {
        // ── High-traffic domestic CDNs (hardcoded, not dependent on
        //     geosite database freshness) ──────────────────────────
        "+.bilibili.com": domesticNameservers,
        "+.douyin.com": domesticNameservers,
        "+.douyincdn.com": domesticNameservers,
        "+.pstatp.com": domesticNameservers,
        "+.byteimg.com": domesticNameservers,
        "+.alicdn.com": domesticNameservers,
        "+.aliyuncs.com": domesticNameservers,
        "+.qpic.cn": domesticNameservers,
        "+.gtimg.com": domesticNameservers,
        "+.qcloud.com": domesticNameservers,

        // ── Apple Music (force domestic DNS for mainland CDN IPs) ──────
        "+.music.apple.com": domesticNameservers,

        // ── Steam CDN (must be first — prevents geolocation-!cn
        //     from intercepting these domains) ──────────────────
        // Valve official content delivery (Akamai mainland nodes)
        "+.steamcontent.com":               domesticNameservers,
        "+.steampipe.akamaized.net":        domesticNameservers,
        "+.steampipe-kr.akamaized.net":     domesticNameservers,
        "+.steampipe-partner.akamaized.net": domesticNameservers,
        // Third-party Steam CDN acceleration (Perfect World, Pinyun, …)
        "+.steam.clngaa.com":               domesticNameservers,
        "+.steam.ksyna.com":                domesticNameservers,
        "+.bscstorage.net":                 domesticNameservers,
        "+.dl.eccdnx.com":                  domesticNameservers,
        "+.dl.pinyuncloud.com":             domesticNameservers,
        "+.steamchina.com":                 domesticNameservers,
        "+.qtlglb.com":                     domesticNameservers,
        "+.queniuqe.com":                   domesticNameservers,
        "+.wmsjsteam.com":                  domesticNameservers,
        "+.wmsj.cn":                        domesticNameservers,

        // ── General split-routing (placed after Steam) ─────────
        // Domestic / private domains → domestic DNS
        "geosite:private,cn,geolocation-cn":
            domesticNameservers,
        // GFW-blocked domains (Google, YouTube, Telegram, GFW list, …)
        // → foreign DNS (avoids DNS poisoning)
        "geosite:google,youtube,telegram,gfw,geolocation-!cn":
            foreignNameservers
    },

    /**
     * Fallback DNS group — used for a second-pass resolution when the
     * nameserver-policy-mapped foreign DNS returns a result that looks
     * poisoned (e.g. a mainland China IP for a foreign-only domain).
     */
    "fallback": foreignNameservers,

    "fallback-filter": {
        "geoip": true,
        "geoip-code": "CN",
        "ipcidr": [],
        "domain": []
    }
};

// ============================================================
//  3.  Rule Providers
// ============================================================

/**
 * Base configuration shared by all rule providers.
 *   type:     http — fetched over HTTPS at startup, then refreshed
 *                    according to the interval.
 *   format:   yaml
 *   interval: 86400 seconds (every 24 hours)
 *   behavior: classical — line-by-line rule format, best
 *             compatibility.
 */
const ruleProviderCommon = {
    "type":     "http",
    "format":   "yaml",
    "interval": 86400,
    "behavior": "classical"
};

// Base URL for blackmatrix7/ios_rule_script rulesets.
const bm7BaseUrl =
    "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash";

const ruleProviders = {
    // ── Advertising & Privacy (highest priority, but still after
    //     Steam DIRECT rules in the routing list) ────────────────
    "advertising": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Advertising/Advertising.yaml`,
        "path": "./ruleset/bm7/advertising.yaml"
    },
    "privacy": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Privacy/Privacy.yaml`,
        "path": "./ruleset/bm7/privacy.yaml"
    },

    // ── Platform services ───────────────────────────────────────
    // TODO: Uncomment the "microsoft" block to route
    //       OneDrive / Office / Windows Update traffic.
    // Microsoft services (partially proxy, partially DIRECT)
    // "microsoft": {
    //     ...ruleProviderCommon,
    //     "url":  `${bm7BaseUrl}/Microsoft/Microsoft.yaml`,
    //     "path": "./ruleset/bm7/microsoft.yaml"
    // },
    // Apple services (App Store, iCloud, Apple Music, …)
    // NOTE: Apple Music and other streaming services require
    //       proxying — do not switch Apple Services to DIRECT.
    "apple": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Apple/Apple.yaml`,
        "path": "./ruleset/bm7/apple.yaml"
    },

    // ── AI services ─────────────────────────────────────────────
    "gemini": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Gemini/Gemini.yaml`,
        "path": "./ruleset/bm7/gemini.yaml"
    },
    "openai": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/OpenAI/OpenAI.yaml`,
        "path": "./ruleset/bm7/openai.yaml"
    },

    // ── Major foreign services ──────────────────────────────────
    "google": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Google/Google.yaml`,
        "path": "./ruleset/bm7/google.yaml"
    },
    // YouTube is given its own rule set for precise matching,
    // preventing accidental routing by GlobalMedia or other rules.
    "youtube": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/YouTube/YouTube.yaml`,
        "path": "./ruleset/bm7/youtube.yaml"
    },
    "telegram": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Telegram/Telegram.yaml`,
        "path": "./ruleset/bm7/telegram.yaml"
    },
    "facebook": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Facebook/Facebook.yaml`,
        "path": "./ruleset/bm7/facebook.yaml"
    },
    "instagram": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Instagram/Instagram.yaml`,
        "path": "./ruleset/bm7/instagram.yaml"
    },
    "twitter": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Twitter/Twitter.yaml`,
        "path": "./ruleset/bm7/twitter.yaml"
    },
    "whatsapp": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/WhatsApp/WhatsApp.yaml`,
        "path": "./ruleset/bm7/whatsapp.yaml"
    },
    "discord": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Discord/Discord.yaml`,
        "path": "./ruleset/bm7/discord.yaml"
    },
    "tiktok": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/TikTok/TikTok.yaml`,
        "path": "./ruleset/bm7/tiktok.yaml"
    },
    // Global media collection (Netflix, Disney+, Spotify, …)
    "global_media": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/GlobalMedia/GlobalMedia.yaml`,
        "path": "./ruleset/bm7/global_media.yaml"
    },
    // Steam store / community (NOT download traffic).
    // Download CDN is handled by hardcoded DIRECT rules at the
    // very top of the routing list.
    "steam": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/Steam/Steam.yaml`,
        "path": "./ruleset/bm7/steam.yaml"
    },

    // ── Loyalsoldier rulesets (domain behaviour, high quality) ──
    // Proxy list (commonly GFW-blocked domains)
    "proxy": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url":  "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
        "path": "./ruleset/loyalsoldier/proxy.yaml"
    },
    // GFW list merged into proxy ruleset (>80% overlap — no longer downloaded separately)
    // "gfw": {
    //     ...ruleProviderCommon,
    //     "behavior": "domain",
    //     "url":  "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
    //     "path": "./ruleset/loyalsoldier/gfw.yaml"
    // },
    // DIRECT list (domains that do not need proxying)
    "direct": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url":  "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
        "path": "./ruleset/loyalsoldier/direct.yaml"
    },
    // Private network (LAN, intranet addresses)
    "private": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url":  "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
        "path": "./ruleset/loyalsoldier/private.yaml"
    },
    // ChinaMax — BM7's full domestic-domain collection.
    // Covers virtually every mainland China site.
    "chinamax": {
        ...ruleProviderCommon,
        "url":  `${bm7BaseUrl}/ChinaMax/ChinaMax.yaml`,
        "path": "./ruleset/bm7/chinamax.yaml"
    },
    /**
     * applications — matches local process names that should always
     *               go DIRECT.
     * Includes: proxy tools (v2ray / xray / frpc — prevents traffic
     *           loops), download clients (Xunlei, qBittorrent — BT
     *           traffic over a proxy is slow and wastes bandwidth).
     */
    "applications": {
        ...ruleProviderCommon,
        "behavior": "classical",
        "url":  "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt",
        "path": "./ruleset/loyalsoldier/applications.yaml"
    },
};

// ============================================================
//  4.  Routing Rules  (top → bottom, first match wins)
// ============================================================
const rules = [

    /**
     * ═══════════════════════════════════════════════════════════
     *  4-0  High-traffic domestic sites — DIRECT  (top of chain)
     * ═══════════════════════════════════════════════════════════
     * Hardcoded DIRECT for the most frequently visited Chinese
     * domains, avoiding traversal of ~10 downstream RULE-SETs.
     * These are already mapped to domestic DNS in nameserver-policy.
     */
    "DOMAIN-SUFFIX,qq.com,DIRECT",
    "DOMAIN-SUFFIX,baidu.com,DIRECT",
    "DOMAIN-SUFFIX,bdstatic.com,DIRECT",
    "DOMAIN-SUFFIX,taobao.com,DIRECT",
    "DOMAIN-SUFFIX,jd.com,DIRECT",
    "DOMAIN-SUFFIX,weixin.com,DIRECT",
    "DOMAIN-SUFFIX,zhihu.com,DIRECT",
    "DOMAIN-SUFFIX,csdn.net,DIRECT",
    "DOMAIN-SUFFIX,gitee.com,DIRECT",

    /**
     * ═══════════════════════════════════════════════════════════
     *  4-1  Steam Download — DIRECT  (highest priority after
     *       domestic sites, before Advertising)
     * ═══════════════════════════════════════════════════════════
     *
     * Why first?
     * BM7's Advertising / Privacy rulesets include REJECT entries
     * for certain Akamai tracking domains.  Steam downloads travel
     * over Akamai CDN (steampipe.akamaized.net, …).  If the Steam
     * rules sit below Advertising, those domains are REJECT-ed and
     * downloads stall at 0 bps.
     *
     * Why DIRECT instead of a proxy group?
     * DIRECT is a Clash built-in — it bypasses all proxy-group
     * dispatch and goes straight to the local NIC.  Combined with
     * nameserver-policy domestic DNS resolution, this yields a
     * mainland China CDN node for optimal throughput.
     *
     * Coverage based on subscribe.yaml Steam DIRECT rules (verified).
     */
    // Valve official Akamai CDN (primary download channel)
    "DOMAIN-KEYWORD,steampipe,DIRECT",
    "DOMAIN-KEYWORD,steamcontent,DIRECT",
    "DOMAIN-SUFFIX,steampipe-kr.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steampipe-partner.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steamcontent.com,DIRECT",
    // Mainland China partner CDN (Perfect World / WMSJ)
    "DOMAIN-SUFFIX,csgo.wmsj.cn,DIRECT",
    "DOMAIN-SUFFIX,dota2.wmsj.cn,DIRECT",
    "DOMAIN-SUFFIX,wmsjsteam.com,DIRECT",
    // Mainland China partner CDN (third-party accelerators)
    "DOMAIN-SUFFIX,dl.steam.clngaa.com,DIRECT",
    "DOMAIN-SUFFIX,dl.steam.ksyna.com,DIRECT",
    "DOMAIN-SUFFIX,st.dl.bscstorage.net,DIRECT",
    "DOMAIN-SUFFIX,st.dl.eccdnx.com,DIRECT",
    "DOMAIN-SUFFIX,st.dl.pinyuncloud.com,DIRECT",
    "DOMAIN-SUFFIX,steampipe.steamcontent.tnkjmec.com,DIRECT",
    // Steam China partner domains (8686c et al.)
    "DOMAIN-SUFFIX,steampowered.com.8686c.com,DIRECT",
    "DOMAIN-SUFFIX,steamstatic.com.8686c.com,DIRECT",
    "DOMAIN-SUFFIX,steamchina.com,DIRECT",
    "DOMAIN-SUFFIX,qtlglb.com,DIRECT",
    "DOMAIN-SUFFIX,queniuqe.com,DIRECT",

    /**
     * ═══════════════════════════════════════════════════════════
     *  4-2  QUIC Block — force Google services onto TCP
     * ═══════════════════════════════════════════════════════════
     *
     * Why block QUIC?
     * Chrome prioritises QUIC (UDP-based) for YouTube, Google, etc.
     * But proxy tunnels (VMess / Trojan / …) handle UDP forwarding
     * poorly — high latency or outright failure → browser waits for
     * timeout → falls back to TCP → result: 2-5 s of blank screen.
     *
     * Blocking UDP 443 removes the QUIC option entirely; the browser
     * goes straight to TCP, saving the timeout delay.
     *
     * Note: AND rules are a Clash Meta extension; Clash Premium
     * does not support them.  Clash Verge Rev ships the Meta kernel,
     * so compatibility is not an issue.
     */
    "AND,((DOMAIN-SUFFIX,googlevideo.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,gstatic.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,googleapis.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,youtube.com),(NETWORK,UDP)),REJECT",
    // [2026-06-09 fix] Force Apple HLS over TCP:
    // Chrome may attempt QUIC/UDP for aod-ssl/mvod/audio-ssl/music.apple.com;
    // proxy tunnels (VMess/Trojan) handle UDP poorly and drop streams,
    // surfacing as ERR_CONNECTION_CLOSED for every chunk.
    "AND,((DOMAIN-SUFFIX,itunes.apple.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,apple.com),(NETWORK,UDP)),REJECT",

    /**
     * ═══════════════════════════════════════════════════════════
     *  4-3  Ad & Privacy Blocking
     * ═══════════════════════════════════════════════════════════
     * Placed after Steam DIRECT rules so Akamai-blocking entries
     * never affect Steam CDN.  Both groups default to REJECT
     * (drop the request); switch to DIRECT in the panel to
     * temporarily disable blocking.
     */
    "RULE-SET,advertising,Ad Block,no-resolve",
    "RULE-SET,privacy,Global Block,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-4  Custom Override Rules  (correct rule-set false positives)
     * ═══════════════════════════════════════════════════════════
     */
    "DOMAIN-SUFFIX,deepseek.com,DIRECT",
    "DOMAIN-SUFFIX,lyun.edu.cn,DIRECT",
    "DOMAIN-SUFFIX,uhdnow.com,US - 美国",
    "DOMAIN,score-6j1.pages.dev,Select Node",
    // TODO: Uncomment to enable Microsoft custom override rules.
    // Microsoft services → Microsoft Services group (default DIRECT)
    // "DOMAIN-SUFFIX,bing.com,Microsoft Services",
    // "DOMAIN-SUFFIX,microsoft.com,Microsoft Services",
    // "DOMAIN-SUFFIX,windowsupdate.com,Microsoft Services",
    // Apple services → Apple Services group
    // Streaming services like Apple Music require proxying;
    // do not switch to DIRECT.
    "DOMAIN-SUFFIX,apple.com,Apple Services",
    "DOMAIN-SUFFIX,hjw01.com,Select Node",

    /**
     * applications rule set — matched by process name, routed DIRECT.
     * Prevents proxy tools (v2ray, …) from looping traffic through
     * themselves, and download clients (Xunlei, …) from wasting
     * bandwidth over a proxy.
     */
    "RULE-SET,applications,DIRECT,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-5  Core Application Routing
     * ═══════════════════════════════════════════════════════════
     */
    "RULE-SET,openai,AI Overseas,no-resolve",
    "RULE-SET,gemini,AI Overseas,no-resolve",
    "RULE-SET,youtube,Foreign Media,no-resolve",
    "RULE-SET,tiktok,Foreign Media,no-resolve",
    "RULE-SET,global_media,Foreign Media,no-resolve",  // Netflix, Disney+, …
    "RULE-SET,telegram,Social Media,no-resolve",
    "RULE-SET,facebook,Social Media,no-resolve",
    "RULE-SET,instagram,Social Media,no-resolve",
    "RULE-SET,twitter,Social Media,no-resolve",
    "RULE-SET,whatsapp,Social Media,no-resolve",
    "RULE-SET,discord,Social Media,no-resolve",
    "RULE-SET,google,Google Services,no-resolve",
    "RULE-SET,steam,Steam,no-resolve",                // store / community only

    // Loyalsoldier proxy list (catch-all for commonly blocked
    // domains — GFW list merged in, as overlap was >80%)
    "RULE-SET,proxy,Select Node,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-6  Platform Service Routing
     * ═══════════════════════════════════════════════════════════
     */
    // BM7 Apple rule set includes Apple CDN; dispatched through
    // the Apple Services proxy group.
    "RULE-SET,apple,Apple Services,no-resolve",
    // TODO: Uncomment to enable Microsoft rule-set routing.
    // "RULE-SET,microsoft,Microsoft Services",

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-7  Domestic Traffic — DIRECT
     * ═══════════════════════════════════════════════════════════
     */
    "RULE-SET,private,DIRECT,no-resolve",    // private / LAN
    "RULE-SET,direct,DIRECT,no-resolve",     // Loyalsoldier DIRECT list
    "RULE-SET,chinamax,DIRECT,no-resolve",   // BM7 full domestic collection (final safety net)

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-8  IP-Layer GeoIP Fallback
     * ═══════════════════════════════════════════════════════════
     * For IP traffic that cannot be matched by domain rules
     * (e.g. certain P2P software).  no-resolve skips DNS lookup
     * and matches against the raw IP directly (better performance).
     */
    "GEOIP,LAN,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",

    /**
     * ═══════════════════════════════════════════════════════════
      *  4-9  Final Catch-All  (traffic leak prevention)
     * ═══════════════════════════════════════════════════════════
     * Any traffic not matched by the rules above (neither domestic
     * nor explicitly routed foreign traffic) goes to the Fallback
     * proxy group.  This prevents accidental DIRECT connections to
     * GFW-blocked IPs.
     */
    "MATCH,Fallback"
];

// ============================================================
//  5.  Proxy Group Base Configuration
// ============================================================
/**
 * Shared defaults for all proxy groups.
 *   interval:        health-check interval in seconds
 *                    (300 = every 5 min)
 *   timeout:         single health-check timeout in milliseconds
 *   url:             health-check target URL
 *                    (gstatic has the best compatibility —
 *                     accessible without proxying)
 *   lazy:            only run health checks when the group is
 *                    actually selected (saves resources)
 *   max-failed-times: consecutive failures before a node is
 *                     marked unavailable
 */
const HEALTH_CHECK_INTERVAL = 300;
const HEALTH_CHECK_TIMEOUT   = 5000;

const groupBaseOption = {
    "interval":  HEALTH_CHECK_INTERVAL,
    "timeout":   HEALTH_CHECK_TIMEOUT,
    "url":       "https://www.gstatic.com/generate_204",
    "lazy":      true,
    "max-failed-times": 3,
    "hidden":    false
};

/**
 * Health-check tiers — different intervals for different usage
 * frequencies:
 *   HOT  — entry / auto-selection groups, need fast state feedback
 *   WARM — functional groups that follow Select Node by default
 *   COLD — infrequently touched service-specific groups
 */
const GROUP_TIERS = {
    HOT:  { interval: 120, timeout: HEALTH_CHECK_TIMEOUT },
    WARM: { interval: HEALTH_CHECK_INTERVAL, timeout: HEALTH_CHECK_TIMEOUT },
    COLD: { interval: 600, timeout: HEALTH_CHECK_TIMEOUT }
};

// ============================================================
//  6.  Entry Point — Configuration Assembly
// ============================================================
function main(config) {
    // Shallow-copy the input so mutations do not corrupt the
    // caller's reference.
    config = {
        ...config,
        "proxies":      [...(config?.proxies       || [])],
        "proxy-groups": [...(config?.["proxy-groups"] || [])]
    };

    // Safety check: ensure the subscription has usable nodes.
    const proxyCount = config?.proxies?.length ?? 0;
    const proxyProviderCount =
        typeof config?.["proxy-providers"] === "object"
            ? Object.keys(config["proxy-providers"]).length
            : 0;
    if (proxyCount === 0 && proxyProviderCount === 0) {
        throw new Error("No proxies found in configuration file");
    }

    // Fully replace the subscription's DNS settings with ours.
    config["dns"] = dnsConfig;

    /**
     * Enable the domain sniffer.
     *
     * When a browser enables Secure DNS (DoH), Clash only sees the
     * resolved IP and cannot match DOMAIN rules.  The sniffer
     * inspects TLS SNI / HTTP Host headers to recover the true
     * domain name.
     *
     * microsoft.com is kept in skip-domain to prevent Windows
     * connectivity checks and other system traffic from breaking
     * due to fake-ip.  This is independent of whether Microsoft
     * routing rules are active — DIRECT traffic does not need
     * domain-rule matching anyway.
     */
    config["sniffer"] = {
        "enable":       true,
        "force-domain": ["+.*"],
        "skip-domain":  [
            "+.mijia.cloud",
            "+.apple.com",
            "+.microsoft.com",
            "+.msftconnecttest.com"
        ]
    };

    // ── Auto-detect regions and create proxy groups ────────────
    // 【Key】JavaScript's \b only fires for [A-Za-z0-9_], NOT for CJK
    // characters.  Node names like "10.日本S02 | IEPL" place non-word
    // characters adjacent to CJK, so \b-wrapped alternatives never
    // match.  CJK keywords are matched without boundaries; English /
    // numeric alternatives keep \b to avoid substring false positives
    // (e.g. SHK matching HK).
    const regions = [
        { name: "HK - 香港", reg: /(?:香港|\bHK\b|\bHONGKONG\b|\bHong\s?Kong\b)/i },
        { name: "JP - 日本", reg: /(?:日本|\bJP\b|\bJAPAN\b|\bJapan\b)/i            },
        { name: "US - 美国", reg: /(?:美国|\bUS\b|\bUSA\b|\bUnited\s?States\b)/i   }
    ];

    // Collect all available proxy names.
    const allProxies = config.proxies
        ?.map(p => p.name)
        .filter(n => typeof n === 'string') || [];

    const FLAG_ICONS = {
        "HK - 香港": "hk.svg",
        "JP - 日本": "jp.svg",
        "US - 美国": "us.svg"
    };
    const FLAG_BASE =
        "https://fastly.jsdelivr.net/gh/clash-verge-rev/" +
        "clash-verge-rev.github.io@main/docs/assets/icons/flags";

    // Build regional groups from matching proxy names.
    const regionalGroups = regions.flatMap(region => {
        const matchingProxies = allProxies.filter(
            name => region.reg.test(name)
        );
        if (matchingProxies.length > 0) {
            return {
                ...groupBaseOption,
                "name":    region.name,
                "type":    "select",
                "proxies": matchingProxies,
                "icon":    `${FLAG_BASE}/${FLAG_ICONS[region.name]}`
            };
        }
        return [];
    });

    const regionalGroupNames = regionalGroups.map(g => g.name);

    // Reusable proxy list shared by functional groups.
    const standardProxies = [
        "Select Node",
        "Latency Test",
        "Failover",
        "Load Balance (Hash)",
        "Load Balance (Round Robin)",
        "DIRECT",
        ...regionalGroupNames
    ];

    /**
     * Proxy Group Definitions
     *
     * Design philosophy
     *   • Select Node — top-level manual entry point.
     *   • Automated groups (Latency Test / Failover / Load
     *     Balance) — intelligent scheduling.
     *   • Functional groups (Steam, Apple, Google, …) — allow
     *     independent per-service policy configuration.
     *   • Every functional group includes a DIRECT option for
     *     one-click switching in the panel.
     *   • Block groups (Global Block / Ad Block) — REJECT by
     *     default.
     */
    config["proxy-groups"] = [
        /**
         * Select Node — manual selection entry point.
         * Lists automated groups + all individual proxies
         * (include-all) as the upstream for functional groups.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name": "Select Node",
            "type": "select",
            "proxies": [
                "Latency Test",
                "Failover",
                "Load Balance (Hash)",
                "Load Balance (Round Robin)",
                ...regionalGroupNames
            ],
            "include-all": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/adjust.svg"
        },
        /**
         * Latency Test — automatically selects the lowest-latency
         * node.  tolerance: 30 ms — do not switch if the latency
         * difference is below this threshold (prevents flapping).
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name":      "Latency Test",
            "type":      "url-test",
            "tolerance": 30,
            "include-all": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/speed.svg"
        },
        /**
         * Failover — when the primary node fails, automatically
         * fall through to the next available node.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name": "Failover",
            "type": "fallback",
            "include-all": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/ambulance.svg"
        },
        /**
         * Load Balance (Hash) — consistent hashing.
         * The same destination domain always maps to the same
         * node (session affinity).  Suitable for services that
         * bind login state to IP.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name":     "Load Balance (Hash)",
            "type":     "load-balance",
            "strategy": "consistent-hashing",
            "include-all": true,
            "hidden": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/merry_go.svg"
        },
        /**
         * Load Balance (Round Robin) — evenly distributes traffic
         * across all nodes.  Suitable for multi-file concurrent
         * downloads where IP consistency is not required.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name":     "Load Balance (Round Robin)",
            "type":     "load-balance",
            "strategy": "round-robin",
            "include-all": true,
            "hidden": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/balance.svg"
        },

        // ── Functional Service Groups ──────────────────────────
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name":    "Google Services",
            "type":    "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/google.svg"
        },
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name":    "Foreign Media",
            "type":    "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/youtube.svg"
        },
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name":    "Social Media",
            "type":    "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/telegram.svg"
        },
        /**
         * AI Overseas — dedicated to ChatGPT / Gemini / etc.
         * Uses chatgpt.com as the health-check target so selected
         * nodes are guaranteed to reach AI services.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "url":             "https://chatgpt.com",
            "expected-status": "200",
            "name":            "AI Overseas",
            "type":            "select",
            "include-all":     false,
            "proxies":          standardProxies,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/chatgpt.svg"
        },
        /**
         * Microsoft Services — defaults to DIRECT (OneDrive,
         * Office 365, etc. are reachable in mainland China).
         * Uses a Microsoft-specific connectivity URL for health
         * checks.
         * TODO: Uncomment this block to enable the group.
         */
        // {
        //     ...groupBaseOption,
        //     "name":     "Microsoft Services",
        //     "type":     "select",
        //     "proxies":  ["DIRECT", ...standardProxies],
        //     "include-all": false,
        //     "url": "http://www.msftconnecttest.com/connecttest.txt",
        //     "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/microsoft.svg"
        // },
        /**
         * Apple Services — defaults to proxy (Apple Music and
         * other streaming services require proxying).
         * NOTE: Switching to DIRECT will break Apple Music and
         *       other services that rely on foreign CDNs.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.COLD,
            "name":    "Apple Services",
            "type":    "select",
            "proxies": standardProxies,
            "include-all": false,
            "url": "https://www.apple.com/library/test/success.html",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/apple.svg"
        },
        /**
         * Steam — store / community routing (non-download).
         * Download traffic is handled by hardcoded DIRECT rules
         * at the very top of the routing list and never reaches
         * this group.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.COLD,
            "name":    "Steam",
            "type":    "select",
            "proxies": standardProxies,
            "include-all": false,
            "url": "https://store.steampowered.com/about/",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/steam.svg"
        },

        // ── Block Groups ───────────────────────────────────────
        // Ad Block — switch to DIRECT in the panel to temporarily
        //            disable advertising blocking (for debugging).
        {
            ...groupBaseOption,
            "name":    "Ad Block",
            "type":    "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/bug.svg"
        },
        // Global Block — egress point for the advertising & privacy
        //                rule sets.  Defaults to REJECT.
        {
            ...groupBaseOption,
            "name":    "Global Block",
            "type":    "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/block.svg"
        },

        /**
         * Fallback — final catch-all for any traffic not matched
         * by the rules above.  Uses Google connectivity check to
         * ensure the selected node can reach foreign sites.
         * Switch to DIRECT in the panel as a last-resort fallback
         * when all proxy nodes are unavailable.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name":    "Fallback",
            "type":    "select",
            "proxies": [
                ...standardProxies.filter(p => p !== "DIRECT"),
                "DIRECT"
            ],
            "include-all": true,
            "url": "https://www.google.com/generate_204",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/fish.svg"
        }
    ];

    // Insert auto-generated regional groups right after Select Node.
    config["proxy-groups"].splice(1, 0, ...regionalGroups);

    // Write rule providers and rules into the config, replacing the
    // subscription's originals.
    config["rule-providers"] = ruleProviders;
    config["rules"]           = rules;

    // Return the final config to be used by Clash Verge Rev.
    return config;
}
