/**
 * Clash Verge Rev - 主配置脚本 (main.js)
 *
 * @version 1.4
 * @date 2026-08-04
 * @description 为 Clash Verge Rev 注入 DNS、路由规则与代理组，实现 Steam 直连、Microsoft 服务支持、广告拦截、地域分流，以及 Telegram / Instagram / UHD 专用分组。
 * 【工作原理】
 * 本文件是一个 JavaScript 预处理脚本，由 Clash Verge Rev 的「配置预处理」功能调用。
 * main(config) 函数接收订阅源（subscribe.yaml）的原始配置作为参数，
 * 对其进行覆盖和增强，然后返回最终生效的配置对象。
 * 这样做的好处是：订阅更新时，自定义规则不会丢失。
 *
 * 【三大核心原则】（在 fake-ip 模式下实现 Steam 下载直连的完整逻辑）
 * 1. 规则列表：从上到下，第一个命中即停止。Steam 直连规则必须在广告规则集之前。
 * 2. fake-ip-filter：Steam CDN 域名 不应 加入此列表。
 *    加入后返回的是真实 IP，domain 规则链会被绕过，导致下载失败。
 * 3. nameserver-policy：Steam CDN 条目必须在 geosite:geolocation-!cn 之前。
 *    否则 steamcontent.com 等域名会被境外 DNS 解析，返回境外 Akamai 节点，直连必然失败。
 */

// ============================================================
// § 1. DNS 服务器定义
// ============================================================

/**
 * 国内 DoH（DNS over HTTPS）服务器列表
 * 用途：解析国内域名、Steam CDN 域名（以获得国内 CDN 节点 IP）
 * 选择标准：稳定、低延迟、无污染
 */
const domesticNameservers = [
    "https://dns.alidns.com/dns-query",  // 阿里云公共 DNS
    "https://doh.pub/dns-query",          // 腾讯 DNSPod
    "https://doh.360.cn/dns-query"        // 360 安全 DNS
];

/**
 * 境外 DoH 服务器列表
 * 用途：解析被 GFW 污染的境外域名（Google、YouTube、Telegram 等）
 * 注意：这些服务器本身需要通过代理访问，由 proxy-server-nameserver 引导
 */
const foreignNameservers = [
    "https://1.1.1.1/dns-query",          // Cloudflare（主）
    "https://1.0.0.1/dns-query",          // Cloudflare（备）
    "https://208.67.222.222/dns-query",   // OpenDNS（主）
    "https://208.67.220.220/dns-query",   // OpenDNS（备）
    "https://194.242.2.2/dns-query",      // Mullvad（主）
    "https://194.242.2.3/dns-query"       // Mullvad（备）
];

// ============================================================
// § 2. DNS 完整配置
// ============================================================

const DNS_LISTEN = "0.0.0.0:1053";
// 【2026-06-09 修复】Windows Web 端 Apple Music 报 ERR_CONNECTION_CLOSED：
// 浏览器对 *.apple.com 同时发起 A + AAAA 解析，Akamai v6 边缘对 chunk 请求经常 RST，
// 表现即 ERR_CONNECTION_CLOSED。Mobile 脚本已强制 v4-only，对齐之。
const DISABLE_IPV6 = true;

const dnsConfig = {
    "enable": true,
    "listen": DNS_LISTEN,

    /**
     * 【关键】禁用 IPv6
     * 原因：部分网络环境 IPv6 路由不稳定，会导致连接超时或失败。
     * Steam、Apple 等服务在双栈环境下可能优先尝试 IPv6 而失败。
     * 注意：纯 IPv6 网络环境需改为 true，否则 DNS 完全不可用。
     */
    "ipv6": DISABLE_IPV6,

    "use-system-hosts": false,
    "cache-algorithm": "arc",

    /**
     * 【模式】fake-ip 增强模式
     * 工作原理：
     *   - 客户端查询任意域名时，Clash 立即返回一个假 IP（198.18.x.x 段）
     *   - 客户端连接到假 IP → Clash 截获 → 查表找回真实域名
     *   - Clash 对域名应用路由规则，决定走代理还是直连
     *   - 若走直连：Clash 内部用 nameserver-policy 解析真实 IP 再连接
     * 优点：DNS 解析极快（无需等待），连接延迟低
     */
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",

    /**
     * fake-ip-filter：这些域名不走 fake-ip，返回真实 IP
     *
     * 【重要陷阱】Steam CDN 域名绝对不能加入此列表！
     * 原因：加入后，Steam 拿到真实 IP 直连，但此时流量是 IP 层，
     * Clash 的 domain 规则（DOMAIN-SUFFIX/KEYWORD）无法匹配，
     * 流量会 fallback 到 MATCH 规则走代理，且可能拿到境外节点 IP 导致 0bps。
     *
     * 此列表仅保留以下必要条目：
     */
    "fake-ip-filter": [
        // 本地设备/局域网（避免局域网发现协议被 fake-ip 干扰）
        "+.lan",
        "+.local",

        // Windows 网络连通性检测（修复任务栏地球图标异常）
        "+.msftconnecttest.com",
        "+.msftncsi.com",

        // ── Microsoft Store / UWP 应用（修复 0x800704cf 联网错误）────────
        // 【2026-06-12 根因修复】Microsoft Store UWP 进程（WinStore.App.exe 等）
        // 在 fake-ip 模式下会获取 198.18.x.x 假 IP，部分内部 WinHTTP 连通性
        // 探测把假 IP 段判为"unreachable"并直接中止，导致 Store 报 0x800704cf
        // (Win32 ERROR_NETWORK_UNREACHABLE)。把这些域名改为返回真实 IP 后，
        // sniffer 通过 TLS Client Hello 还原 SNI，DOMAIN 规则照常匹配，DIRECT
        // 直连真实 CDN。代价：DNS 一次真实解析（Clash 缓存，损耗可忽略）。
        "+.microsoft.com",
        "+.live.com",
        "+.mp.microsoft.com",
        "+.microsoftstore.com",
        "+.onestore.ms",

        // QQ 快速登录检测（fake-ip 会导致本地登录失败）
        "localhost.ptlogin2.qq.com",
        "localhost.sec.qq.com",

        // 微信快速登录检测（同上）
        "localhost.work.weixin.qq.com",
    ],

    /**
     * 默认 Nameserver（纯 IP，无域名）
     * 用途：在 DoH 服务器域名自身需要被解析时（冷启动），用这些 IP 做初始 DNS 查询。
     * 规则：必须是纯 IP 地址，不能是域名（否则形成鸡生蛋的死循环）。
     * 方案：国内 + 境外混搭，保证境内外 DoH 服务器域名都能被正确解析。
     */
    "default-nameserver": ["223.5.5.5", "119.29.29.29", "1.1.1.1", "8.8.8.8"],

    // 通用 nameserver：默认用国内 DNS，nameserver-policy 会覆盖特定域名的解析
    "nameserver": domesticNameservers,

    // 用于解析代理服务器域名（机场节点域名），必须用国内能访问的 DNS
    "proxy-server-nameserver": domesticNameservers,

    /**
     * nameserver-policy：为特定域名指定解析 DNS
     *
     * 【核心机制】从上到下，第一个匹配即停止（类似路由规则）。
     *
     * 【Steam 直连的 DNS 关键】
     * Steam 下载 CDN（如 steamcontent.com、*.akamaized.net）是境外域名，
     * 若不显式指定，会命中下方的 geosite:geolocation-!cn → 用境外 DNS 解析
     * → 1.1.1.1 返回美国/欧洲 Akamai 节点 IP → 中国大陆直连此类 IP = 0bps。
     *
     * 解决方案：将 Steam CDN 条目放在 geolocation-!cn 之前，
     * 强制用国内 DNS 解析 → 获得国内 Akamai CDN 节点 IP → 直连高速，
     * 与 subscribe.yaml（无 DNS 配置，直接用系统国内 DNS）效果完全一致。
     */
    "nameserver-policy": {
        // ── 高频国内服务 CDN（硬编码兜底，不依赖 geosite 数据库时效）──────
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

        // ── Apple Music（强制国内 DNS 拿大陆 CDN IP，否则直连失败）────────
        "+.music.apple.com": domesticNameservers,

        // ── Microsoft 服务 CDN（强制国内 DNS 拿大陆 CDN IP）───────────────
        "+.microsoft.com": domesticNameservers,
        "+.microsoftonline.com": domesticNameservers,
        "+.windows.net": domesticNameservers,
        "+.msidentity.com": domesticNameservers,
        "+.msauth.net": domesticNameservers,
        "+.azure.com": domesticNameservers,
        "+.office.com": domesticNameservers,
        "+.office365.com": domesticNameservers,
        "+.live.com": domesticNameservers,
        "+.outlook.com": domesticNameservers,
        "+.windowsupdate.com": domesticNameservers,
        "+.mp.microsoft.com": domesticNameservers,

        // ── Steam CDN（必须最先，防止被 geolocation-!cn 截胡）──────────────
        // Valve 官方内容分发（使用 Akamai 国内节点）
        "+.steamcontent.com": domesticNameservers,
        "+.steampipe.akamaized.net": domesticNameservers,
        "+.steampipe-kr.akamaized.net": domesticNameservers,
        "+.steampipe-partner.akamaized.net": domesticNameservers,
        // 国内第三方 Steam CDN 加速节点（完美世界、品云等）
        "+.steam.clngaa.com": domesticNameservers,
        "+.steam.ksyna.com": domesticNameservers,
        "+.bscstorage.net": domesticNameservers,
        "+.dl.eccdnx.com": domesticNameservers,
        "+.dl.pinyuncloud.com": domesticNameservers,
        "+.steamchina.com": domesticNameservers,
        "+.qtlglb.com": domesticNameservers,
        "+.queniuqe.com": domesticNameservers,
        "+.wmsjsteam.com": domesticNameservers,
        "+.wmsj.cn": domesticNameservers,

        // ── 通用分流规则（放在 Steam 之后）────────────────────────────────
        // 国内域名 / 私有域名 → 国内 DNS
        "geosite:private,cn,geolocation-cn": domesticNameservers,
        // 被墙域名（Google、YouTube、GFW 列表等）→ 境外 DNS（防止 DNS 污染）
        "geosite:google,youtube,telegram,gfw,geolocation-!cn": foreignNameservers
    },

    /**
     * fallback DNS 组：当 nameserver-policy 指向的 foreignNameservers
     * 返回的结果被判定为污染（如 GFW 投毒 IP）时，使用此组做二次解析。
     * 境外域名走 foreign DNS 若返回了国内 IP → 触发 fallback 二次验证。
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
// § 3. 规则集（Rule Providers）定义
// ============================================================

/**
 * 规则集基础配置
 * - type: http，从网络下载（首次启动时获取，之后按 interval 刷新）
 * - format: yaml
 * - interval: 86400 秒（每 24 小时更新一次）
 * - behavior: classical（逐条规则格式，兼容性最好）
 */
const ruleProviderCommon = {
    "type": "http",
    "format": "yaml",
    "interval": 86400,
    "behavior": "classical"
};

// BM7（blackmatrix7/ios_rule_script）规则集基础 URL，便于统一管理版本
const bm7BaseUrl = "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Clash";

const ruleProviders = {
    // ── 广告 & 隐私（最高优先级，但仍在 Steam 直连之后）──────────────────
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

    // ── 平台服务 ───────────────────────────────────────────────────────────
    "microsoft": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Microsoft/Microsoft.yaml`,
        "path": "./ruleset/bm7/microsoft.yaml"
    },
    // Apple 服务（App Store、iCloud、Apple Music 等）
    // 注意：Apple Music 等流媒体需走代理，不可将 Apple Services 组切为直连
    "apple": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Apple/Apple.yaml`,
        "path": "./ruleset/bm7/apple.yaml"
    },

    // ── AI 服务 ────────────────────────────────────────────────────────────
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

    // ── 境外主流服务 ────────────────────────────────────────────────────────
    "google": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Google/Google.yaml`,
        "path": "./ruleset/bm7/google.yaml"
    },
    // GitHub 系服务（github.com / ghcr.io / npmjs.com / Copilot 等）
    "github": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/GitHub/GitHub.yaml`,
        "path": "./ruleset/bm7/github.yaml"
    },
    // YouTube 单独分出，精确命中，避免被 GlobalMedia 或其他规则误判
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
    // VK（VKontakte）：俄罗斯社交平台全生态（社交 / 视频 / VK Play 游戏）
    "vk": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/VK/VK.yaml`,
        "path": "./ruleset/bm7/vk.yaml"
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
    // 境外流媒体合集（Netflix、Disney+、Spotify 等）
    "global_media": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/GlobalMedia/GlobalMedia.yaml`,
        "path": "./ruleset/bm7/global_media.yaml"
    },
    // Steam 商店 / 社区（非下载流量），下载 CDN 已在规则列表顶部用硬编码处理
    "steam": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/Steam/Steam.yaml`,
        "path": "./ruleset/bm7/steam.yaml"
    },

    // ── Loyalsoldier 规则集（domain 行为，高质量维护）──────────────────────
    // 代理列表（常见被墙域名）
    "proxy": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt",
        "path": "./ruleset/loyalsoldier/proxy.yaml"
    },
    // GFW 列表已合并到 proxy 规则集中，不再单独下载（两者重叠 >80%）
    // "gfw": {
    //     ...ruleProviderCommon,
    //     "behavior": "domain",
    //     "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/gfw.txt",
    //     "path": "./ruleset/loyalsoldier/gfw.yaml"
    // },
    // 直连列表（常见无需代理的域名）
    "direct": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt",
        "path": "./ruleset/loyalsoldier/direct.yaml"
    },
    // 私有网络（局域网、内网地址）
    "private": {
        ...ruleProviderCommon,
        "behavior": "domain",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/private.txt",
        "path": "./ruleset/loyalsoldier/private.yaml"
    },
    // ChinaMax：BM7 维护的国内域名全量合集，覆盖几乎所有国内站点
    "chinamax": {
        ...ruleProviderCommon,
        "url": `${bm7BaseUrl}/ChinaMax/ChinaMax.yaml`,
        "path": "./ruleset/bm7/chinamax.yaml"
    },
    /**
     * applications：按进程名识别需要直连的本地应用
     * 包括：v2ray/xray/frpc 等代理工具（防止代理自身流量形成环路）
     *       迅雷、qBittorrent 等下载工具（BT 流量走代理会很慢且费流量）
     */
    "applications": {
        ...ruleProviderCommon,
        "behavior": "classical",
        "url": "https://fastly.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/applications.txt",
        "path": "./ruleset/loyalsoldier/applications.yaml"
    },
};

// ============================================================
// § 4. 路由规则列表（从上到下，第一个命中即停止）
// ============================================================
const rules = [

    /**
     * ══════════════════════════════════════════════════════
     * § 4-0. 高频国内服务直连（规则链最顶部，减少后续规则集遍历）
     * ══════════════════════════════════════════════════════
     * 国内流量占比最高的域名硬编码为 DIRECT，跳过后续 ~10 条 RULE-SET 匹配开销。
     * 这些域名已同步加入 nameserver-policy 确保国内 DNS 解析。
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
     * ══════════════════════════════════════════════════════
     * § 4-1. Steam 下载直连（仅次于国内高频域名，在所有规则集之前）
     * ══════════════════════════════════════════════════════
     *
     * 【为什么必须放在最顶部？】
     * BM7 的 Advertising/Privacy 规则集中包含 Akamai CDN 的部分追踪域名封锁条目。
     * Steam 下载走的正是 Akamai CDN（steampipe.akamaized.net 等）。
     * 若 Steam CDN 规则不在广告规则集之前，这些域名会被 REJECT，导致下载 0bps。
     *
     * 【为什么用 DIRECT 而非代理组？】
     * DIRECT 是 Clash 核心内建指令，绕过所有代理组调度，直接走本地网卡。
     * 结合 nameserver-policy 的国内 DNS 解析，可以获得国内 CDN 节点，实现最优速度。
     *
     * 【覆盖范围】来源：subscribe.yaml 的 Steam 直连规则（经过验证可用）
     */
    // Valve 官方 Akamai CDN（最常用的下载通道）
    "DOMAIN-KEYWORD,steampipe,DIRECT",
    "DOMAIN-KEYWORD,steamcontent,DIRECT",
    "DOMAIN-SUFFIX,steampipe-kr.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steampipe-partner.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT",
    "DOMAIN-SUFFIX,steamcontent.com,DIRECT",
    // 国内合作 CDN（完美世界 / WMSJ）
    "DOMAIN-SUFFIX,csgo.wmsj.cn,DIRECT",
    "DOMAIN-SUFFIX,dota2.wmsj.cn,DIRECT",
    "DOMAIN-SUFFIX,wmsjsteam.com,DIRECT",
    // 国内合作 CDN（其他第三方加速节点）
    "DOMAIN-SUFFIX,dl.steam.clngaa.com,DIRECT",
    "DOMAIN-SUFFIX,dl.steam.ksyna.com,DIRECT",
    "DOMAIN-SUFFIX,st.dl.bscstorage.net,DIRECT",
    "DOMAIN-SUFFIX,st.dl.eccdnx.com,DIRECT",
    "DOMAIN-SUFFIX,st.dl.pinyuncloud.com,DIRECT",         // 品云 CDN
    "DOMAIN-SUFFIX,steampipe.steamcontent.tnkjmec.com,DIRECT",
    // Steam 中国区合作域名（8686c 等）
    "DOMAIN-SUFFIX,steampowered.com.8686c.com,DIRECT",
    "DOMAIN-SUFFIX,steamstatic.com.8686c.com,DIRECT",
    "DOMAIN-SUFFIX,steamchina.com,DIRECT",
    "DOMAIN-SUFFIX,qtlglb.com,DIRECT",
    "DOMAIN-SUFFIX,queniuqe.com,DIRECT",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-2. QUIC 阻断：强制 Google 系服务走 TCP
     * ══════════════════════════════════════════════════════
     *
     * 【为什么需要阻断 QUIC？】
     * Chrome 对 YouTube / Google 等服务默认优先使用 QUIC（基于 UDP）。
     * 但代理隧道（VMess / Trojan 等）对 UDP 转发支持较差：
     * QUIC 的 UDP 包经代理转发 → 延迟大或直接失败 → 浏览器等待超时
     * → 降级回 TCP 重连 → 结果：页面白屏 2-5 秒后才开始加载。
     *
     * 阻断 UDP 443 后，浏览器连 QUIC 的机会都没有，直接走 TCP，
     * 省去超时等待，实现秒开。
     *
     * 【注意】AND 规则是 Clash Meta 扩展语法，Clash Premium 不支持。
     * Clash Verge Rev 内置 Meta 内核，无需担心兼容性。
     */
    "AND,((DOMAIN-SUFFIX,googlevideo.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,gstatic.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,googleapis.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,youtube.com),(NETWORK,UDP)),REJECT",
    // 【2026-06-09 修复】Apple HLS 强制走 TCP：
    // Chrome 可能对 aod-ssl/mvod/audio-ssl/music.apple.com 尝试 QUIC/UDP，
    // 代理隧道（VMess/Trojan）对 UDP 多路支持差，会丢包导致 chunk 全部 ERR_CONNECTION_CLOSED。
    "AND,((DOMAIN-SUFFIX,itunes.apple.com),(NETWORK,UDP)),REJECT",
    "AND,((DOMAIN-SUFFIX,apple.com),(NETWORK,UDP)),REJECT",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-3. 广告与隐私拦截
     * ══════════════════════════════════════════════════════
     * 放在 Steam 直连之后，防止 Akamai 封锁规则误杀 Steam CDN。
     * Ad Block / Global Block 组默认走 REJECT（丢弃请求），可在面板切为 DIRECT 临时关闭拦截。
     */
    "RULE-SET,advertising,Ad Block,no-resolve",
    "RULE-SET,privacy,Global Block,no-resolve",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-4. 自定义修正规则（处理规则集的误判）
     * ══════════════════════════════════════════════════════
     */
    // ── Microsoft Store 后端 & 运行时 API → DIRECT（绕过 Microsoft Services 代理组）─
    // 【关键】Store "failed to initialize" 报错的根因：这些 API 域名被 RULE-SET,microsoft 捕获
    // 走 Microsoft Services 代理组处理。WebSocket/SSE 实时连接经代理组可能中断。
    // 这里在 RULE-SET 之前精确匹配，让 Store 流量完全绕过代理组直连。
    "DOMAIN-KEYWORD,microsoftstore,DIRECT",
    "DOMAIN-KEYWORD,onestore,DIRECT",
    "DOMAIN-SUFFIX,apps.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,assets.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,onestore.ms,DIRECT",
    "DOMAIN-SUFFIX,microsoftstore.com,DIRECT",
    "DOMAIN-SUFFIX,events.data.microsoft.com,DIRECT",
    "DOMAIN-KEYWORD,watson.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,pipe.aria.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,msn.com,DIRECT",
    "DOMAIN-SUFFIX,storecatalogrevocation.storequality.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,windowssearch.com,DIRECT",
    // ── Microsoft Store UWP 进程（TUN 模式下进程级兜底）───────────────────
    // 即使未来 Store 改用新域名，只要是这 3 个进程产生的流量都 DIRECT。
    // 需 TUN 模式 + find-process-mode: strict（Clash Meta/Mihomo 默认 strict）。
    "PROCESS-NAME,WinStore.App.exe,DIRECT",
    "PROCESS-NAME,Microsoft.StorePurchaseApp.exe,DIRECT",
    "PROCESS-NAME,Microsoft.WindowsStore*,DIRECT",
    // ── Microsoft Store / winget CDN → DIRECT ─────────────────────────────
    // 【必读】TUN 模式 + UWP 流程：
    // 1) 开启 Clash Verge Rev 的 TUN 模式（设置 → TUN 模式 → 开启）
    // 2) PowerShell 管理员执行 UWP 回环豁免（如仍无效）：
    //    CheckNetIsolation.exe LoopbackExempt -a -n=Microsoft.WindowsStore_8wekyb3d8bbwe
    "DOMAIN-SUFFIX,mp.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,delivery.mp.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,winget.microsoft.com,DIRECT",
    // ── Microsoft Store & Windows 认证 → DIRECT（登录、帐号管理）───────────
    "DOMAIN-SUFFIX,login.live.com,DIRECT",
    "DOMAIN-SUFFIX,login.windows.net,DIRECT",
    "DOMAIN-SUFFIX,account.live.com,DIRECT",
    // ── Windows Update / 下载 CDN → DIRECT ────────────────────────────────
    "DOMAIN-SUFFIX,download.windowsupdate.com,DIRECT",
    "DOMAIN-SUFFIX,download.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,officecdn.microsoft.com,DIRECT",
    "DOMAIN-SUFFIX,wns.windows.com,DIRECT",
    // ── Copilot → AI Overseas（后端 API 被墙，强制代理）─────────────────
    "DOMAIN-SUFFIX,copilot.microsoft.com,AI Overseas",
    "DOMAIN-SUFFIX,edgeservices.bing.com,AI Overseas",
    "DOMAIN-SUFFIX,sydney.bing.com,AI Overseas",
    "DOMAIN-SUFFIX,api.copilot.microsoft.com,AI Overseas",
    // ── Bing → Microsoft Services（与微软流量同组，面板可统一切换）────
    // 注意：edgeservices.bing.com / sydney.bing.com 已在上方交给 AI Overseas（Copilot）。
    "DOMAIN-SUFFIX,bing.com,Microsoft Services",
    "DOMAIN-SUFFIX,bing.net,Microsoft Services",
    "DOMAIN-SUFFIX,bingusercontent.com,Microsoft Services",
    // ── OpenCode → OpenCode 组（Zen 网关 / 登录 / 分享 / 文档）──────────
    // opencode.ai 承载 OpenCode Zen API 网关、OAuth 登录、会话分享与文档站，
    // 是 opencode 自有流量的统一入口。anoma.ly 为其母公司域（账单/帮助站）。
    // 注意：BYOK 直连第三方 LLM 的流量（api.openai.com 等）不走此组，
    // 由现有 openai 规则集 / proxy / Fallback 统一调度。
    "DOMAIN-SUFFIX,opencode.ai,OpenCode",
    "DOMAIN-SUFFIX,anoma.ly,OpenCode",
    "DOMAIN-SUFFIX,deepseek.com,DIRECT",
    "DOMAIN-SUFFIX,lyun.edu.cn,DIRECT",
    "DOMAIN-SUFFIX,uhdnow.com,UHD",            // 超高清流媒体走 UHD 专用组
    "DOMAIN,score-6j1.pages.dev,Select Node",
    // ── VK → VK 组（BM7 VK 规则集未收录的 VK 生态域名：社交 / 视频 / 游戏全覆盖）──
    "DOMAIN-SUFFIX,vk.ru,VK",
    "DOMAIN-SUFFIX,vkvideo.ru,VK",
    "DOMAIN-SUFFIX,vk.me,VK",
    "DOMAIN-SUFFIX,vk.link,VK",
    "DOMAIN-SUFFIX,mycdn.me,VK",
    "DOMAIN-SUFFIX,vkplay.ru,VK",
    "DOMAIN-SUFFIX,vkplay.live,VK",
    // Apple：强制走 Apple Services 组（流媒体如 Apple Music 需保持代理，勿切直连）
    "DOMAIN-SUFFIX,apple.com,Apple Services",
    "DOMAIN-SUFFIX,hjw01.com,Select Node",

    /**
     * applications 规则集：按进程名匹配，走 DIRECT
     * 防止代理工具自身产生流量循环（v2ray 经由自身转发 → 无限递归）
     * 防止下载工具（迅雷等）走代理浪费带宽
     */
    "RULE-SET,applications,DIRECT,no-resolve",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-5. 核心应用路由
     * ══════════════════════════════════════════════════════
     */
    "RULE-SET,openai,AI Overseas,no-resolve",
    "RULE-SET,gemini,AI Overseas,no-resolve",
    "RULE-SET,youtube,Foreign Media,no-resolve",      // YouTube 单独指定，防止被其他规则截胡
    "RULE-SET,tiktok,Foreign Media,no-resolve",
    "RULE-SET,global_media,Foreign Media,no-resolve", // Netflix、Disney+ 等境外流媒体合集
    "RULE-SET,telegram,Telegram,no-resolve",   // Telegram 独立分流
    "RULE-SET,facebook,Social Media,no-resolve",
    "RULE-SET,instagram,Instagram,no-resolve", // Instagram 独立分流
    "RULE-SET,vk,VK,no-resolve",               // VK 独立分流（社交 / 视频 / VK Play）
    "RULE-SET,twitter,Social Media,no-resolve",
    "RULE-SET,whatsapp,Social Media,no-resolve",
    "RULE-SET,discord,Social Media,no-resolve",
    "RULE-SET,google,Google Services,no-resolve",
    "RULE-SET,steam,Steam,no-resolve",                // Steam 商店/社区（下载 CDN 已在顶部处理）
    "RULE-SET,github,GitHub,no-resolve",   // GitHub 系服务独立分流（github.com / ghcr.io / npm 等）

    // Loyalsoldier 代理列表（兜底覆盖常见被墙域名，已合并原 gfw 规则集）
    "RULE-SET,proxy,Select Node,no-resolve",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-6. 平台服务路由
     * ══════════════════════════════════════════════════════
     */
    // BM7 Apple 规则集包含 Apple CDN，交给 Apple Services 组统一调度
    "RULE-SET,apple,Apple Services,no-resolve",
    "RULE-SET,microsoft,Microsoft Services",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-7. 国内流量直连
     * ══════════════════════════════════════════════════════
     */
    "RULE-SET,private,DIRECT,no-resolve",    // 私有网络域名
    "RULE-SET,direct,DIRECT,no-resolve",     // Loyalsoldier 直连列表
    "RULE-SET,chinamax,DIRECT,no-resolve",   // BM7 国内全量（几乎覆盖所有国内域名，最终兜底）

    /**
     * ══════════════════════════════════════════════════════
     * § 4-8. IP 层 GeoIP 兜底
     * ══════════════════════════════════════════════════════
     * 针对无法用域名规则识别的 IP 直连流量（如某些 P2P 软件）
     * no-resolve：跳过 DNS 解析，直接对 IP 进行 IP 规则匹配（提升效率）
     */
    "GEOIP,LAN,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",

    /**
     * ══════════════════════════════════════════════════════
     * § 4-9. 最终兜底（流量泄漏保护）
     * ══════════════════════════════════════════════════════
     * 所有未被以上规则命中的流量（既不是国内，也未被显式路由的境外流量）
     * 一律送入 Fallback 组等待代理，防止泄漏或意外直连被墙 IP。
     */
    "MATCH,Fallback"
];

// ============================================================
// § 5. 代理组基础配置
// ============================================================
/**
 * 所有代理组共享的基础参数
 * - interval: 健康检查间隔（秒），300 = 每 5 分钟检测一次节点可用性
 * - timeout: 单次健康检查超时（毫秒）
 * - url: 健康检查目标 URL（gstatic 兼容性最好，不需要翻墙）
 * - lazy: 懒加载，只在被选中时才发起健康检查（节省资源）
 * - max-failed-times: 连续失败多少次后标记节点不可用
 */
const HEALTH_CHECK_INTERVAL = 300;
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
 * 健康检查分层：不同使用频率的代理组采用不同的检查间隔
 * - HOT：入口组 / 自动切换组，需要快速感知节点状态变化
 * - WARM：功能组，默认跟随 Select Node，常规频率即可
 * - COLD：特定低频服务组，延长间隔减少开销
 */
const GROUP_TIERS = {
    HOT:  { interval: 120, timeout: HEALTH_CHECK_TIMEOUT },
    WARM: { interval: HEALTH_CHECK_INTERVAL, timeout: HEALTH_CHECK_TIMEOUT },
    COLD: { interval: 600, timeout: HEALTH_CHECK_TIMEOUT }
};

// ============================================================
// § 6. 程序入口 - 配置组装
// ============================================================
function main(config) {
    // 浅拷贝输入，避免原地修改污染调用方持有的引用
    config = {
        ...config,
        "proxies": [...(config?.proxies || [])],
        "proxy-groups": [...(config?.["proxy-groups"] || [])]
    };

    // 安全检查：确保订阅源中有可用节点
    const proxyCount = config?.proxies?.length ?? 0;
    const proxyProviderCount =
        typeof config?.["proxy-providers"] === "object"
            ? Object.keys(config["proxy-providers"]).length
            : 0;
    if (proxyCount === 0 && proxyProviderCount === 0) {
        throw new Error("No proxies found in configuration file");
    }

    // 用本脚本的 DNS 配置完整覆盖订阅源的 DNS 设置
    config["dns"] = dnsConfig;

    // 【新增】开启 sniffer 域名嗅探
    // 解决浏览器开启安全 DNS (DoH) 时，Clash 只能获取到目标 IP 而无法匹配 DOMAIN 规则的问题
    // 【注意】保留 msftconnecttest.com 是为了防止 Windows NCSI 因 fake-ip 异常。
    // microsoft.com 已移除：Store 用 WebView 渲染，skip 会阻止 sniffer 识别真实 SNI 域名，
    // 导致 DOMAIN 规则无法正确匹配。msftncsi.com 仍在 fake-ip-filter 中保护 NCSI。
    config["sniffer"] = {
        "enable": true,
        "force-domain": ["+.*"],
        "skip-domain": [
            "+.mijia.cloud",
            "+.apple.com",
            "+.msftconnecttest.com"
        ]
    };

    // 持久化代理组选择与 fake-ip 映射（重启后不丢失）
    config["profile"] = {
        "store-selected": true,
        "store-fake-ip": true
    };

    // ── 自动识别地区并创建分组 ──────────────────────────────────────────
    // 定义需要识别的地区及其关键词
    // 【关键】JavaScript 的 \b 只对 [A-Za-z0-9_] 生效，匹配不了 CJK 字符。
    // 节点名如 "10.日本S02 | IEPL" 中"日本"两侧不是 word character，
    // 用 \b 包裹会无法匹配。因此 CJK 关键词直接匹配（无边界），
    // 英文/数字关键词仍保留 \b 以避免子串误匹配（如 SHK 命中 HK）。
    const regions = [
        { name: "HK - 香港", reg: /(?:香港|\bHK\b|\bHONGKONG\b|\bHong\s?Kong\b)/i },
        { name: "JP - 日本", reg: /(?:日本|\bJP\b|\bJAPAN\b|\bJapan\b)/i            },
        { name: "US - 美国", reg: /(?:美国|\bUS\b|\bUSA\b|\bUnited\s?States\b)/i   },
        { name: "SG - 新加坡", reg: /(?:新加坡|\bSG\b|\bSINGAPORE\b|\bSingapore\b)/i },
        { name: "TW - 台湾",   reg: /(?:台湾|臺灣|臺湾|\bTW\b|\bTAIWAN\b|\bTaiwan\b)/i }
    ];

    // 获取所有可用节点名称
    const allProxies = config.proxies?.map(p => p.name).filter(n => typeof n === 'string') || [];

    const FLAG_ICONS = {
        "HK - 香港": "hk.svg",
        "JP - 日本": "jp.svg",
        "US - 美国": "us.svg",
        "SG - 新加坡": "sg.svg",
        "TW - 台湾":   "tw.svg"
    };
    const FLAG_BASE = "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/flags";

    // 生成地区分组配置
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
    // 作为功能组上游，让非主流节点被有效利用。
    const othersGroup = {
        ...groupBaseOption,
        "name": "Others",
        "type": "select",
        "include-all": true,
        "icon": `${FLAG_BASE}/un.svg`
    };

    // 获取已生成的地区组名称列表（含 Others，使其成为功能组可选上游）
    const regionalGroupNames = [...regionalGroups.map(g => g.name), "Others"];
    const standardProxies = ["Select Node", "Latency Test", "Failover", "Load Balance (Hash)", "Load Balance (Round Robin)", "DIRECT", ...regionalGroupNames];

    /**
     * 代理组定义
     *
     * 【设计理念】
     * - 顶层选择组（Select Node）提供手动选择入口
     * - 自动化组（Latency Test / Failover / Load Balance）提供智能调度
     * - 功能性分组（Steam / Apple / Google 等）允许对特定服务独立配置策略
     * - 所有功能性组都保留 DIRECT 选项，需要直连时可从面板切换
     * - 拦截组（Global Block / Ad Block）使用 REJECT 作为默认策略
     *
     * 【显示顺序】常用组在前，不常用组在 Fallback 之后：
     *   Select Node → 主流地区(HK/JP/US) → 功能组 → Fallback
     *   → Others/SG/TW → Latency Test/Failover/Load Balance → Ad Block/Global Block
     * 仅视觉聚合，引用关系不变（Select Node 仍指向 Latency Test 等）。
     */
    config["proxy-groups"] = [
        /**
         * Select Node：手动选择节点的顶层入口
         * 包含所有节点 + 三种自动化组，作为其他功能组的上游
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

        // ── 功能性服务分组（常用区）──────────────────────────────────────
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
             * GitHub：github.com / ghcr.io / npmjs.com 等 GitHub 系服务
             * 由 RULE-SET,github 直连本组；上游为 standardProxies
             * （Bettbox 版关闭本组时，规则回退到 Fallback）
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
         * UHD：专用于 uhdnow.com 等超高清流媒体
         * 上游为 standardProxies，可在面板中手动选择节点
         * （Bettbox 版关闭本组时，规则回退到 Foreign Media）
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
         * Telegram：Telegram 专用路由组
         * 由 RULE-SET,telegram 直连本组；上游为 standardProxies
         * （Bettbox 版关闭本组时，规则回退到 Social Media）
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
         * Instagram：Instagram 专用路由组
         * 由 RULE-SET,instagram 直连本组；上游为 standardProxies
         * （Bettbox 版关闭本组时，规则回退到 Social Media）
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
         * VK：VK（VKontakte）俄罗斯社交平台全生态专用路由组
         * 由 RULE-SET,vk 与补充 DOMAIN-SUFFIX 直连本组；上游为 standardProxies
         * 健康检查用 vk.com，测速直接反映节点能否访问 VK
         * （Bettbox 版关闭本组时，规则回退到 Social Media）
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.WARM,
            "url": "https://vk.com",
            "expected-status": "200",
            "name": "VK",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "icon": "https://fastly.jsdelivr.net/npm/simple-icons@12/icons/vk.svg"
        },
        /**
         * AI Overseas：专用于 ChatGPT / Gemini 等 AI 服务
         * 使用 chatgpt.com 作为健康检查目标，确保选中的节点真正能访问 AI 服务
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
         * OpenCode：opencode 命令行 AI 编程代理的自有流量组
         * 覆盖 opencode.ai（Zen API 网关 / OAuth 登录 / 会话分享 / 文档站）
         * 与母公司域 anoma.ly（账单 / 帮助站）。
         * 健康检查目标用官网首页，确保选中节点能访问 opencode.ai。
         * 注意：用户 BYOK 直连第三方 LLM（api.openai.com 等）的流量
         * 不经过此组，仍由 openai 规则集 / proxy / Fallback 调度。
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
         * Microsoft Services：默认直连（Bing、OneDrive、Office 等国内可直连）
         * Copilot 等需要代理的服务已在规则层单独路由到 AI Overseas
         * 面板中可切为代理以覆盖所有微软流量
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
         * Apple Services：默认走代理（Apple Music 等流媒体需要代理）
         * 注意：若切为 DIRECT，Apple Music 等依赖境外 CDN 的服务将无法使用
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
         * Steam：Steam 商店 / 社区的路由组（非下载流量）
         * Steam 下载流量已在规则列表顶部用硬编码 DIRECT 处理，不经过此组
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.COLD,
            "name": "Steam",
            "type": "select",
            "proxies": standardProxies,
            "include-all": false,
            "url": "https://store.steampowered.com/about/",
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/steam.svg"
        },

        /**
         * Fallback（兜底组）：所有未被规则命中的流量最终落点
         * 使用 Google 连通性检测，确保选中的节点能访问境外网站。
         * 面板中可将 Fallback 切为 DIRECT 作为节点全不可用时的降级兜底。
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

        // ── 自动化组（不常用区，Fallback 之后）────────────────────────────
        /**
         * Latency Test：自动选择延迟最低的节点
         * tolerance: 30ms，节点延迟差距小于此值则不切换（防止频繁跳节点）
         */
        {
            ...groupBaseOption,
            ...GROUP_TIERS.HOT,
            "name": "Latency Test",
            "type": "url-test",
            "tolerance": 30,
            "include-all": true,
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/speed.svg"
        },
        /**
         * Failover：主节点失效后自动切换到下一个可用节点
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
         * Load Balance (Hash)：对同一目标域名始终用同一节点（会话一致性）
         * 适合：需要保持 IP 稳定的服务（如某些网站的登录态绑定 IP）
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
         * Load Balance (Round Robin)：轮询所有节点，均匀分摊流量
         * 适合：多文件并发下载等不需要 IP 一致性的场景
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

        // ── 拦截组（不常用区末尾）──────────────────────────────────────────
        // Ad Block：可在面板手动切为 DIRECT 临时关闭广告拦截（调试用）
        {
            ...groupBaseOption,
            "name": "Ad Block",
            "type": "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/bug.svg"
        },
        // Global Block：广告/隐私规则集的流量出口，默认 REJECT
        {
            ...groupBaseOption,
            "name": "Global Block",
            "type": "select",
            "proxies": ["REJECT", "DIRECT"],
            "icon": "https://fastly.jsdelivr.net/gh/clash-verge-rev/clash-verge-rev.github.io@main/docs/assets/icons/block.svg"
        }
    ];

    // ── 分区插入地区分组 ──────────────────────────────────────────────
    // 主流地区（HK/JP/US）插在 Select Node 之后，属常用区；
    // 非主流地区（SG/TW）+ Others 插在 Fallback 之后，属不常用区。
    const mainstreamGroups = regionalGroups.filter(
        g => !["SG - 新加坡", "TW - 台湾"].includes(g.name)
    );
    const uncommonRegionalGroups = regionalGroups.filter(
        g => ["SG - 新加坡", "TW - 台湾"].includes(g.name)
    );

    // 主流地区插在 Select Node 之后
    config["proxy-groups"].splice(1, 0, ...mainstreamGroups);

    // Others + 非主流地区插在 Fallback 之后
    const fallbackIdx = config["proxy-groups"].findIndex(g => g.name === "Fallback");
    config["proxy-groups"].splice(fallbackIdx + 1, 0, othersGroup, ...uncommonRegionalGroups);


    // 将规则集和规则写入配置，覆盖订阅源原有的规则
    config["rule-providers"] = ruleProviders;
    config["rules"] = rules;

    // 返回最终配置，Clash Verge Rev 将使用此配置启动
    return config;
}