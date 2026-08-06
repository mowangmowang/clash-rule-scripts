/**
 * Clash Meta Mobile - Configuration Script (main.js)
 *
 * @version     1.4
 * @date        2026-08-04
 * @target      Clash Meta for Android (2.11+), Stash (iOS)
 * @description Injects DNS, routing rules, proxy groups and regional
 *              auto-grouping into the upstream subscription config,
 *              with Microsoft services support (Outlook mobile /
 *              OneDrive mobile / Authenticator). Derived from the
 *              desktop Clash Verge Rev script, stripped of
 *              desktop-only logic (Steam, process-name rules, icons),
 *              and adds dedicated Telegram / Instagram / UHD groups.
 *
 * 【How it works】
 * This file is a JavaScript preprocessor consumed by the Clash Meta
 * kernel's script engine.  main(config) receives the raw subscription
 * config as a parameter, overrides and enhances it, then returns the
 * final configuration object.
 *
 * 【Mobile-specific changes over the desktop script】
 * - All Steam CDN / download rules removed  (desktop-only).
 * - applications rule-provider removed       (process-name matching
 *   is unreliable on Android due to selinux isolation).
 * - `icon` properties retained               (verified rendering on
 *   Clash Meta for Android 2.11+ and Stash iOS).
 * - IPv6 disabled by default                 (cellular carrier IPv6
 *   routing is frequently broken).
 * - Health-check intervals lengthened        (reduce battery drain
 *   from unnecessary radio wake-ups).
 * - Latency tolerance increased to 50 ms     (cellular jitter).
 * - Mobile captive-portal & connectivity-check domains added.
 */

// ============================================================
// §1.  DNS Server Definitions
// ============================================================

/**
 * Domestic DoH (DNS over HTTPS) servers.
 * Used for: domestic domains, Apple Music CDN.
 * Selection criteria: stable, low latency, no DNS poisoning.
 */
const domesticNameservers = [
    "https://dns.alidns.com/dns-query",  // AliCloud Public DNS
    "https://doh.pub/dns-query",          // Tencent DNSPod
    "https://doh.360.cn/dns-query"        // 360 Secure DNS
];

/**
 * Foreign DoH servers.
 * Used for: GFW-blocked domains (Google, YouTube, Telegram, etc.).
 * Note: these servers must be reachable through the proxy — the
 * proxy-server-nameserver bootstraps their resolution.
 */
const foreignNameservers = [
    "https://1.1.1.1/dns-query",          // Cloudflare (primary)
    "https://1.0.0.1/dns-query",          // Cloudflare (secondary)
    "https://208.67.222.222/dns-query",   // OpenDNS (primary)
    "https://208.67.220.220/dns-query",   // OpenDNS (secondary)
    "https://194.242.2.2/dns-query",      // Mullvad (primary)
    "https://194.242.2.3/dns-query"       // Mullvad (secondary)
];

// ============================================================
// §2.  Full DNS Configuration
// ============================================================

const DNS_LISTEN = "0.0.0.0:1053";
const DISABLE_IPV6 = true;  // Mobile: carrier IPv6 is frequently broken

const dnsConfig = {
    "enable": true,
    "listen": DNS_LISTEN,

    /**
     * 【Mobile】IPv6 disabled.
     * Many Chinese cellular carriers have broken IPv6 routing, causing
     * connection timeouts.  On pure-IPv6 networks this must be set to
     * true, otherwise DNS becomes completely unavailable.
     */
    "ipv6": DISABLE_IPV6,

    "use-system-hosts": false,
    "cache-algorithm": "arc",

    /**
     * 【Mode】fake-ip enhanced mode
     * How it works:
     *   - When a client queries any domain, Clash immediately returns a
     *     fake IP (198.18.x.x range).
     *   - The client connects to the fake IP → Clash intercepts → looks
     *     up the real domain from its table.
     *   - Clash applies routing rules to the domain, decides proxy or DIRECT.
     *   - For DIRECT: Clash resolves the real IP via nameserver-policy internally.
     * Benefit: nearly instant DNS resolution, low connection latency.
     */
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",

    /**
     * fake-ip-filter — domains that bypass fake-ip (resolve to real IPs)
     *
     * Keep this list minimal.  Only include entries that would break
     * if they received a fake IP.
     */
    "fake-ip-filter": [
        // Local devices / LAN  (mDNS / Bonjour services need real IPs)
        "+.lan",
        "+.local",

        // ── Mobile connectivity checks ───────────────────────────────
        // Android: without a real IP, Android shows "No internet" on WiFi
        "+.connectivitycheck.gstatic.com",
        "+.clients3.google.com",
        // iOS: captive portal detection — fake-IP makes iOS think there's
        // no internet and show the "Login" WiFi popup
        "+.captive.apple.com",

        // ── Microsoft services (Outlook mobile / OneDrive / Authenticator) ──
        // [2026-06-12] Same fake-IP UWP-style probe issue observed on some
        // Microsoft mobile clients — the app's internal network probe flags
        // 198.18.x.x as "unreachable" and reports "no internet".  Returning
        // real IPs (cached by Clash) lets the connections reach the actual
        // Microsoft CDN.  Routing rules still match via sniffer SNI recovery.
        "+.microsoft.com",
        "+.live.com",
        "+.mp.microsoft.com",
        "+.microsoftonline.com",
        "+.office.com",
    ],

    /**
     * Default nameserver (pure IP, no domain).
     * Used for: resolving the DoH server domain names themselves on cold
     * start (otherwise it's a chicken-and-egg deadlock).
     * Rule: must be bare IP addresses — never domains.
     */
    "default-nameserver": ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],

    // Global nameserver: default to domestic DNS; nameserver-policy overrides
    // specific domains.
    "nameserver": domesticNameservers,

    // Resolves proxy-server domain names (airport nodes); must use DNS
    // reachable without a proxy.
    "proxy-server-nameserver": domesticNameservers,

    /**
     * nameserver-policy — per-domain DNS resolver assignment.
     *
     * 【Core mechanism】top → bottom, first match wins  (same as routing rules).
     */
    "nameserver-policy": {
        // ── High-traffic domestic CDN (hardcoded fallback) ──────────────
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

        // ── Microsoft 关键服务 CDN ─────────────────────────────────────
        "+.microsoft.com": domesticNameservers,
        "+.office.com": domesticNameservers,
        "+.office365.com": domesticNameservers,
        "+.live.com": domesticNameservers,
        "+.outlook.com": domesticNameservers,

        // ── General split-routing ──────────────────────────────────────
        // Domestic / private → domestic DNS
        "geosite:private,cn,geolocation-cn": domesticNameservers,
        // Blocked domains (Google, YouTube, GFW list) → foreign DNS
        "geosite:google,youtube,telegram,gfw,geolocation-!cn": foreignNameservers
    },

    /**
     * Fallback DNS group: when the nameserver-policy result is flagged as
     * poisoned (GFW-injected IP), this group performs secondary resolution.
     * If a foreign DNS result contains a domestic IP → fallback re-checks.
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
// §3.  Rule Providers  (Rule-Set Definitions)
// ============================================================

/**
 * Shared rule-provider defaults.
 * - type:   http, fetched from CDN.
 * - format: yaml.
 * - interval: 86400 s  (24 h — refresh once per day).
 * - behavior: classical  (per-rule format, best compatibility).
 */
const ruleProviderCommon = {
    "type": "http",
    "format": "yaml",
    "interval": 86400,
    "behavior": "classical"
};

// BM7 (blackmatrix7/ios_rule_script) base URL for unified version management.
const bm7BaseUrl = "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash";

const ruleProviders = {
    // ── Advertising & Privacy  (highest priority after domestic & QUIC) ─
    "advertising": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Advertising/Advertising.yaml`,
        "path": "./ruleset/bm7/advertising.yaml"
    },
    "privacy": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Privacy/Privacy.yaml`,
        "path": "./ruleset/bm7/privacy.yaml"
    },

    // ── Platform Services ──────────────────────────────────────────────
    // Apple services (App Store, iCloud, Apple Music, etc.)
    // Streaming services like Apple Music require proxying — do NOT switch
    // the Apple Services group to DIRECT.
    "apple": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Apple/Apple.yaml`,
        "path": "./ruleset/bm7/apple.yaml"
    },

    "microsoft": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Microsoft/Microsoft.yaml`,
        "path": "./ruleset/bm7/microsoft.yaml"
    },

    // ── AI Services ────────────────────────────────────────────────────
    "gemini": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Gemini/Gemini.yaml`,
        "path": "./ruleset/bm7/gemini.yaml"
    },
    "openai": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/OpenAI/OpenAI.yaml`,
        "path": "./ruleset/bm7/openai.yaml"
    },

    // ── Foreign mainstream services ────────────────────────────────────
    "google": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Google/Google.yaml`,
        "path": "./ruleset/bm7/google.yaml"
    },
    // GitHub services (github.com / ghcr.io / npmjs.com / Copilot)
    "github": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/GitHub/GitHub.yaml`,
        "path": "./ruleset/bm7/github.yaml"
    },
    "youtube": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/YouTube/YouTube.yaml`,
        "path": "./ruleset/bm7/youtube.yaml"
    },
    "telegram": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Telegram/Telegram.yaml`,
        "path": "./ruleset/bm7/telegram.yaml"
    },
    "facebook": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Facebook/Facebook.yaml`,
        "path": "./ruleset/bm7/facebook.yaml"
    },
    "instagram": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Instagram/Instagram.yaml`,
        "path": "./ruleset/bm7/instagram.yaml"
    },
    "twitter": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Twitter/Twitter.yaml`,
        "path": "./ruleset/bm7/twitter.yaml"
    },
    "whatsapp": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/WhatsApp/WhatsApp.yaml`,
        "path": "./ruleset/bm7/whatsapp.yaml"
    },
    "discord": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Discord/Discord.yaml`,
        "path": "./ruleset/bm7/discord.yaml"
    },
    "tiktok": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/TikTok/TikTok.yaml`,
        "path": "./ruleset/bm7/tiktok.yaml"
    },
    "global_media": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/GlobalMedia/GlobalMedia.yaml`,
        "path": "./ruleset/bm7/global_media.yaml"
    },

    // ── Loyalsoldier rule sets  (domain behaviour, high quality) ──────
    // Proxy list (commonly blocked domains)
    "proxy": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
        "path": "./ruleset/loyalsoldier/proxy.yaml"
    },
    // DIRECT list (domains that never need a proxy)
    "direct": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
        "path": "./ruleset/loyalsoldier/direct.yaml"
    },
    // Private networks (LAN, intranet addresses)
    "private": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
        "path": "./ruleset/loyalsoldier/private.yaml"
    },
    // ChinaMax — BM7's full domestic-domain collection
    "chinamax": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/ChinaMax/ChinaMax.yaml`,
        "path": "./ruleset/bm7/chinamax.yaml"
    },
};

// ============================================================
// §4.  Routing Rules  (top → bottom, first match wins)
// ============================================================
const rules = [

    /**
     * ═══════════════════════════════════════════════════════
     * §4-0.  High-traffic domestic sites — DIRECT (top of chain)
     * ═══════════════════════════════════════════════════════
     * Hardcoded DIRECT for the most frequently visited Chinese
     * domains, skipping ~10 downstream RULE-SET traversals.
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
     * ═══════════════════════════════════════════════════════
     * §4-1.  QUIC Block — force Google services onto TCP
     * ═══════════════════════════════════════════════════════
     *
     * Why block QUIC?
     * Chrome on Android aggressively prioritises QUIC/UDP for YouTube,
     * Google, etc.  But proxy tunnels (VMess / Trojan / …) handle UDP
     * forwarding poorly — high latency or outright failure → timeout →
     * TCP fallback → blank screen for 2-5 s.
     *
     * Blocking UDP 443 removes the QUIC option; the browser goes
     * straight to TCP, saving the timeout delay.
     *
     * Compatibility: AND rules are a Clash Meta extension.  Clash Meta
     * for Android supports them natively.  Stash (iOS) supports AND +
     * NETWORK rules since v3.0.2 (April 2025).  Clash Premium does NOT
     * support AND rules.
     */
    "AND,((DOMAIN-SUFFIX,googlevideo.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,gstatic.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,googleapis.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,youtube.com),(NETWORK,UDP)),REJECT",
    // [2026-06-09 fix, synced 2026-06-10] Force Apple HLS over TCP:
    // Chrome may attempt QUIC/UDP for aod-ssl/mvod/audio-ssl/music.apple.com;
    // proxy tunnels (VMess/Trojan) handle UDP poorly and drop streams,
    // surfacing as ERR_CONNECTION_CLOSED for every chunk.
    "AND,((DOMAIN-SUFFIX,itunes.apple.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,apple.com),(NETWORK,UDP)),REJECT",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-2.  Ad & Privacy Blocking
     * ═══════════════════════════════════════════════════════
     * Both groups default to REJECT.  Switch to DIRECT in the
     * dashboard to temporarily disable blocking.
     */
    "RULE-SET,advertising,Ad Block,no-resolve",
    "RULE-SET,privacy,Global Block,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-3.  Custom Override Rules  (correct rule-set false positives)
     * ═══════════════════════════════════════════════════════
     */
    // ── Microsoft Store 后端 & 运行时 API → DIRECT（绕过 Microsoft Services 代理组）─
    // Store 的内容初始化 API 被 RULE-SET,microsoft 捕获后走代理组可能出问题。
    // 移动端没有 Microsoft Store 应用，但用户可能用浏览器访问 Store Web 端。
    "DOMAIN-KEYWORD,microsoftstore,DIRECT",
    "DOMAIN-KEYWORD,onestore,DIRECT",
    "DOMAIN-SUFFIX,apps.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,assets.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,onestore.ms,DIRECT",
    "DOMAIN-SUFFIX,microsoftstore.com,DIRECT",
    "DOMAIN-SUFFIX,msn.com,DIRECT",
    // ── Copilot → AI Overseas（后端 API 被墙，强制代理）─────────────────
    "DOMAIN-SUFFIX,copilot.microsoft.com,AI Overseas",
    "DOMAIN-SUFFIX,edgeservices.bing.com,AI Overseas",
    "DOMAIN-SUFFIX,sydney.bing.com,AI Overseas",
    "DOMAIN-SUFFIX,api.copilot.microsoft.com,AI Overseas",
    // ── OpenCode → OpenCode 组（Zen 网关 / 登录 / 分享 / 文档）──────────
    // opencode.ai 承载 OpenCode Zen API 网关、OAuth 登录、会话分享与文档站。
    // anoma.ly 为母公司域（账单 / 帮助站）。
    // 注意：BYOK 直连第三方 LLM 的流量不走此组，仍由现有规则调度。
    "DOMAIN-SUFFIX,opencode.ai,OpenCode",
    "DOMAIN-SUFFIX,anoma.ly,OpenCode",
    "DOMAIN-SUFFIX,login.live.com,DIRECT",
    "DOMAIN-SUFFIX,account.live.com,DIRECT",
    "DOMAIN-SUFFIX,deepseek.com,DIRECT",
    "DOMAIN-SUFFIX,lyun.edu.cn,DIRECT",
    "DOMAIN-SUFFIX,uhdnow.com,UHD",            // UHD streaming uses a dedicated group
    "DOMAIN,score-6j1.pages.dev,Select Node",
    // Apple services → Apple Services group
    // Streaming services like Apple Music require proxying;
    // do not switch to DIRECT.
    "DOMAIN-SUFFIX,apple.com,Apple Services",
    "DOMAIN-SUFFIX,hjw01.com,Select Node",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-4.  Core Application Routing
     * ═══════════════════════════════════════════════════════
     */
    "RULE-SET,openai,AI Overseas,no-resolve",
    "RULE-SET,gemini,AI Overseas,no-resolve",
    "RULE-SET,youtube,Foreign Media,no-resolve",       // standalone to avoid misrouting
    "RULE-SET,tiktok,Foreign Media,no-resolve",
    "RULE-SET,global_media,Foreign Media,no-resolve",  // Netflix, Disney+, … combined
    "RULE-SET,telegram,Telegram,no-resolve",   // Telegram uses a dedicated group
    "RULE-SET,facebook,Social Media,no-resolve",
    "RULE-SET,instagram,Instagram,no-resolve", // Instagram uses a dedicated group
    "RULE-SET,twitter,Social Media,no-resolve",
    "RULE-SET,whatsapp,Social Media,no-resolve",
    "RULE-SET,discord,Social Media,no-resolve",
    "RULE-SET,google,Google Services,no-resolve",
    "RULE-SET,github,GitHub,no-resolve",   // GitHub services (github.com, ghcr.io, npm, ...)

    // Loyalsoldier proxy list (catch-all for commonly blocked domains)
    "RULE-SET,proxy,Select Node,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-5.  Platform Service Routing
     * ═══════════════════════════════════════════════════════
     */
    "RULE-SET,microsoft,Microsoft Services",
    // BM7 Apple rule set includes Apple CDN; routed via Apple Services group.
    "RULE-SET,apple,Apple Services,no-resolve",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-6.  Domestic Traffic — DIRECT
     * ═══════════════════════════════════════════════════════
     */
    "RULE-SET,private,DIRECT,no-resolve",    // private network domains
    "RULE-SET,direct,DIRECT,no-resolve",     // Loyalsoldier DIRECT list
    "RULE-SET,chinamax,DIRECT,no-resolve",   // BM7 ChinaMax (near-complete domestic coverage)

    /**
     * ═══════════════════════════════════════════════════════
     * §4-7.  IP-layer GeoIP Fallback
     * ═══════════════════════════════════════════════════════
     * For IP-only traffic that cannot be matched by domain rules
     * (e.g. some P2P apps).  no-resolve skips the DNS step.
     */
    "GEOIP,LAN,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",

    /**
     * ═══════════════════════════════════════════════════════
     * §4-8.  Final Catch-All  (traffic leak prevention)
     * ═══════════════════════════════════════════════════════
     * Any traffic not matched by the rules above (neither domestic
     * nor explicitly routed foreign traffic) goes to the Fallback
     * proxy group.  This prevents accidental DIRECT connections to
     * GFW-blocked IPs.
     */
    "MATCH,Fallback"
];

// ============================================================
// §5.  Proxy Group Base Configuration
// ============================================================
/**
 * Shared defaults for all proxy groups.
 *   interval:        health-check interval in seconds.
 *   timeout:         single health-check timeout in milliseconds.
 *   url:             health-check target URL
 *                    (gstatic has the best compatibility —
 *                     accessible without proxying).
 *   lazy:            only run health checks when the group is
 *                    actually selected (saves resources & battery).
 *   max-failed-times: consecutive failures before a node is
 *                     marked unavailable.
 *
 * 【Mobile】intervals are longer than the desktop version to
 * reduce battery drain from unnecessary radio wake-ups.
 */
const HEALTH_CHECK_INTERVAL = 600;
const HEALTH_CHECK_TIMEOUT = 5000;

const groupBaseOption = {
    "interval": HEALTH_CHECK_INTERVAL,
    "timeout": HEALTH_CHECK_TIMEOUT,
    "url": "https://www.gstatic.com/generate_204",
    "lazy": true,
    "max-failed-times": 3,
    "hidden": false
};

/**
 * Tiered health-check intervals.
 * Different proxy groups have different usage frequencies.
 *
 * 【Mobile】all tiers are longer:
 *   HOT:  300 s  (was 120)
 *   WARM: 600 s  (was 300)
 *   COLD: 900 s  (was 600)
 */
const GROUP_TIERS = {
    HOT:  { interval: 300, timeout: HEALTH_CHECK_TIMEOUT },
    WARM: { interval: 600, timeout: HEALTH_CHECK_TIMEOUT },
    COLD: { interval: 900, timeout: HEALTH_CHECK_TIMEOUT }
};

// ============================================================
// §6.  Entry Point — Configuration Assembly
// ============================================================
function main(config) {
    // Shallow-copy to avoid mutating the caller's reference.
    config = {
        ...config,
        "proxies": [...(config?.proxies || [])],
        "proxy-groups": [...(config?.["proxy-groups"] || [])]
    };

    // Safety check: ensure the subscription contains usable nodes.
    const proxyCount = config?.proxies?.length ?? 0;
    const proxyProviderCount =
        typeof config?.["proxy-providers"] === "object"
            ? Object.keys(config["proxy-providers"]).length
            : 0;
    if (proxyCount === 0 && proxyProviderCount === 0) {
        throw new Error("No proxies found in configuration file");
    }

    // Override the subscription DNS config with our own.
    config["dns"] = dnsConfig;

    /**
     * Enable domain sniffing.
     *
     * Without sniffing, Clash only sees destination IPs when the browser
     * or app uses HTTPS with encrypted SNI.  This prevents DOMAIN-based
     * rule matching.
     *
     * skip-domain entries prevent sniffing from interfering with
     * critical system-level connectivity checks on mobile OSes.
     */
    config["sniffer"] = {
        "enable": true,
        "force-domain": ["+.*"],
        "skip-domain": [
            "+.mijia.cloud",               // Xiaomi smart home
            "+.apple.com",                  // iOS system services (APNs, iCloud auth)
            "+.captive.apple.com",          // iOS captive portal detection
            "+.gstatic.com",                // Android Google Play Services connectivity
            "+.icloud.com"                  // iCloud sync reliability
        ]
    };

    // 持久化代理组选择与 fake-ip 映射（重启后不丢失）
    config["profile"] = {
        "store-selected": true,
        "store-fake-ip": true
    };

    // ── Regional auto-detection & grouping ─────────────────────────────
    // 【Key】JavaScript's \b only fires for [A-Za-z0-9_], NOT for CJK
    // characters.  Node names like "10.日本S02 | IEPL" place non-word
    // characters adjacent to CJK, so \b-wrapped alternatives never
    // match.  CJK keywords are matched without boundaries; English /
    // numeric alternatives keep \b to avoid substring false positives
    // (e.g. SHK matching HK).
    const regions = [
        { name: "HK - 香港", reg: /(?:香港|\bHK\b|\bHONGKONG\b|\bHong\s?Kong\b)/i },
        { name: "JP - 日本", reg: /(?:日本|\bJP\b|\bJAPAN\b|\bJapan\b)/i            },
        { name: "US - 美国", reg: /(?:美国|\bUS\b|\bUSA\b|\bUnited\s?States\b)/i   },
        { name: "SG - 新加坡", reg: /(?:新加坡|\bSG\b|\bSINGAPORE\b|\bSingapore\b)/i },
        { name: "TW - 台湾",   reg: /(?:台湾|臺灣|臺湾|\bTW\b|\bTAIWAN\b|\bTaiwan\b)/i }
    ];

    // 【Mobile】Icon assets for regional groups.
    // Verified rendering on Clash Meta for Android and Stash.
    const FLAG_ICONS = {
        "HK - 香港": "hk.svg",
        "JP - 日本": "jp.svg",
        "US - 美国": "us.svg",
        "SG - 新加坡": "sg.svg",
        "TW - 台湾":   "tw.svg"
    };
    const FLAG_BASE = "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags";

    // Get all available node names.
    const allProxies = config.proxies?.map(p => p.name).filter(n => typeof n === 'string') || [];

    // Generate regional proxy groups with country-flag icons.
    const regionalGroups = regions.flatMap(region => {
        const matchingProxies = allProxies.filter(name => region.reg.test(name));
        if (matchingProxies.length > 0) {
            return {
                ...groupBaseOption,
                "name": region.name,
                "type": "select",
                "proxies": matchingProxies,
                "icon": `${FLAG_BASE}/${FLAG_ICONS[region.name]}`
            };
        }
        return [];
    });

    // ── Others：聚合所有节点，覆盖非主流地区（KR/DE/UK 等）──────────────
    // 主流地区（HK/JP/US/SG/TW）已有独立分组，其余节点通过此组统一调度。
    // 仅用 include-all 由 Clash 自动注入全部 outbound proxies + proxy providers，
    // 按名排序且无重复（proxies 字段不列节点，避免与 include-all 作用域重叠）。
    const othersGroup = {
        ...groupBaseOption,
        "name": "Others",
        "type": "select",
        "include-all": true,
        "icon": `${FLAG_BASE}/un.svg`
    };

    // Names of auto-generated regional groups (incl. Others, so it becomes
    // an available upstream for every functional group).
    const regionalGroupNames = [...regionalGroups.map(g => g.name), "Others"];
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
     * Proxy group definitions.
     *
     * Design philosophy:
     * - Top-level Select Node provides a manual selection entry point.
     * - Auto groups (Latency Test / Failover / Load Balance) provide
     *   smart scheduling.
     * - Functional groups (Google / Apple / Social Media / etc.) allow
     *   independent strategy configuration per service.
     * - All functional groups include DIRECT as an option.
     *
     * Display order — common groups first, uncommon groups after
     * Fallback:
     *   Select Node → mainstream regions (HK/JP/US) → functional
     *   groups → Fallback → Others / SG / TW → Latency Test /
     *   Failover / Load Balance → Ad Block / Global Block.
     * Visual clustering only; reference relationships unchanged.
     */
    config["proxy-groups"] = [
        /**
         * Select Node — manual selection entry point.
         * Includes all nodes + three automation groups as upstream.
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

        // ── Functional service groups (common) ─────────────────────────
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Google Services",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/google.svg"
        },
        {
            /**
             * GitHub - github.com / ghcr.io / npmjs.com and related GitHub services.
             * Routed by RULE-SET,github; upstream is standardProxies.
             */
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "GitHub",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/github.svg"
        },
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Foreign Media",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/youtube.svg"
        },
        /**
         * UHD - dedicated group for uhdnow.com UHD streaming.
         * Upstream is standardProxies; pick a node in the panel.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "UHD",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/ForeignMedia.png"
        },
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Social Media",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/telegram.svg"
        },
        /**
         * Telegram - dedicated routing group.
         * Routed directly by RULE-SET,telegram; upstream is standardProxies.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Telegram",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Telegram.png"
        },
        /**
         * Instagram - dedicated routing group.
         * Routed directly by RULE-SET,instagram; upstream is standardProxies.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Instagram",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Instagram.png"
        },
        /**
         * AI Overseas — dedicated to ChatGPT / Gemini / etc.
         * Uses chatgpt.com as health-check target to ensure the selected
         * node can actually reach AI services.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "url": "https://chatgpt.com",
            "expected-status": "200",
            "name": "AI Overseas",
            "type": "select",
            "include-all": false,
            "proxies": standardProxies,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/chatgpt.svg"
        },
        /**
         * OpenCode — opencode 命令行 AI 编程代理的自有流量组
         * 覆盖 opencode.ai（Zen 网关 / 登录 / 分享 / 文档）与 anoma.ly（母公司域）。
         * 健康检查目标用官网首页。BYOK 直连第三方 LLM 的流量不走此组。
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "url": "https://opencode.ai",
            "expected-status": "200",
            "name": "OpenCode",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Stack.png"
        },
        /**
         * Microsoft Services — defaults to DIRECT (Bing, OneDrive,
         * Office etc. are accessible in mainland China).
         * Copilot is already routed to AI Overseas at the rule level.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.COLD,
            "name": "Microsoft Services",
            "type": "select",
            "proxies": ["DIRECT", ...standardProxies.filter(p => p !== "DIRECT")],
            "include-all": true,
            "url": "http://www.msftconnecttest.com/connecttest.txt",
            "expected-status": "200",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/microsoft.svg"
        },
        /**
         * Apple Services — default to proxy.
         * Apple Music and other streaming services rely on foreign CDNs
         * and will not work if switched to DIRECT.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.COLD,
            "name": "Apple Services",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "url": "https://www.apple.com/library/test/success.html",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/apple.svg"
        },

        /**
         * Fallback (catch-all group) — where all unmatched traffic lands.
         * Uses google.com/generate_204 as the health-check target to
         * ensure the selected node can actually reach foreign sites.
         * DIRECT is included as a last resort when all nodes are down.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name": "Fallback",
            "type": "select",
            "proxies": [
                ...standardProxies.filter(p => p !== "DIRECT"),
                "DIRECT"
            ],
            "include-all": true,
            "url": "https://www.google.com/generate_204",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/fish.svg"
        },

        // ── Auto groups (uncommon, after Fallback) ─────────────────────
        /**
         * Latency Test — auto-selects the lowest-latency node.
         * tolerance: 50 ms  (cellular latency fluctuates more than wired).
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name": "Latency Test",
            "type": "url-test",
            "tolerance": 50,
            "include-all": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/speed.svg"
        },
        /**
         * Failover — switches to the next available node when the
         * primary fails.
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
         * Load Balance (Hash) — consistent-hashing: the same destination
         * domain always goes to the same node (session affinity).
         * Suitable for services that bind sessions to IP.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Load Balance (Hash)",
            "type": "load-balance",
            "strategy": "consistent-hashing",
            "include-all": true,
            "hidden": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/merry_go.svg"
        },
        /**
         * Load Balance (Round Robin) — evenly distributes traffic across
         * all nodes.
         * Suitable for concurrent multi-file downloads that don't need
         * IP consistency.
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "name": "Load Balance (Round Robin)",
            "type": "load-balance",
            "strategy": "round-robin",
            "include-all": true,
            "hidden": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/balance.svg"
        },

        // ── Blocking groups (end of uncommon section) ──────────────────
        // Ad Block — switch to DIRECT in the dashboard to temporarily
        // disable ad blocking for debugging.
        {
            ...groupBaseOption,
            "name": "Ad Block",
            "type": "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/bug.svg"
        },
        // Global Block — traffic outlet for the privacy rule set.
        {
            ...groupBaseOption,
            "name": "Global Block",
            "type": "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/block.svg"
        }
    ];

    // ── Split regional groups into mainstream / uncommon sections ────
    // 主流地区（HK/JP/US）插在 Select Node 之后（常用区）；
    // 非主流地区（SG/TW）+ Others 插在 Fallback 之后（不常用区）。
    const mainstreamGroups = regionalGroups.filter(
        g => !["SG - 新加坡", "TW - 台湾"].includes(g.name)
    );
    const uncommonRegionalGroups = regionalGroups.filter(
        g => ["SG - 新加坡", "TW - 台湾"].includes(g.name)
    );

    // Mainstream regions after Select Node.
    config["proxy-groups"].splice(1, 0, ...mainstreamGroups);

    // Others + uncommon regions after Fallback.
    const fallbackIdx = config["proxy-groups"].findIndex(g => g.name === "Fallback");
    config["proxy-groups"].splice(fallbackIdx + 1, 0, othersGroup, ...uncommonRegionalGroups);

    // Write rule-providers and rules into the config, replacing the
    // subscription's original entries.
    config["rule-providers"] = ruleProviders;
    config["rules"] = rules;

    // Return the final config; Clash Meta will use this to start.
    return config;
}
