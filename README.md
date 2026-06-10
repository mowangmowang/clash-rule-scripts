# Clash Rule Scripts

> 个人用的 Clash 代理配置预处理脚本集。
> 三个 JS 文件,夹在订阅源和 Clash 客户端之间,
> 注入 DNS、路由规则、代理组,让 fake-ip 模式也能稳跑 Steam 等下载。

## 这是什么 / 不什么

- ✅ 是:Clash Verge Rev / Clash Meta for Android / Stash 用的 JS 预处理脚本
- ✅ 解决:fake-ip 模式下 Steam 下载为 0 bps、广告拦截、CN/境外分流、移动端兼容
- ❌ 不是:Clash 完整规则集(规则大部分来自订阅源)
- ❌ 不是:Clash 客户端本体(只增强配置,不替代)
- ❌ 不包含:订阅 URL / token / 节点信息(这些由 Clash 客户端运行时注入)

## 三个文件

| 文件 | 适用客户端 | 注释语言 | 当前版本 | 字节 |
|------|-----------|---------|---------|------|
| `Clash_script_v1.js` | Clash Verge Rev(桌面) | 中文 | v1.1 | 41.5 KB |
| `Clash_script_v1_en.js` | Clash Verge Rev(桌面) | English | v1.1 | 43.8 KB |
| `Clash_script_mobile.js` | Clash Meta for Android / Stash (iOS) | 中文 | v1.0 | 33.8 KB |

桌面中英两版**功能完全一致**,仅注释语言不同。
**任何对桌面版的修改必须同步两个文件。**

## 怎么用

**桌面(Clash Verge Rev):**
1. Profiles → 选一个 profile → 预处理(Processing) → Script
2. 填入脚本绝对路径,例如 `C:\Users\alize\Desktop\developer\VPS\script\Clash_script_v1_en.js`
3. 重载 profile,日志里会看到 `main(config)` 调用

**移动(Clash Meta for Android / Stash):**
1. 设置 → 脚本 / Script → 启用 JS 预处理
2. 路径填入 `Clash_script_mobile.js`
3. 重载配置

## 脚本工作机制

Clash 客户端在加载订阅源后,会调用 `main(config)` 传入配置对象。
脚本**就地修改**这个对象(覆盖 DNS、规则、代理组),然后返回。
订阅源更新时自定义规则**不会丢失**——因为它们是脚本注入,不是写进 YAML。

## 可定制点(最常改的)

打开任一 JS 文件,顶部一节是「常量定义」,改完保存即可生效:

| 变量 | 控制什么 | 常见改动 |
|------|---------|---------|
| `domesticNameservers` | 国内 DNS(解析 CN 域名) | 换更快的 DoH,如 `https://1.12.12.12/dns-query` |
| `overseasNameservers` | 境外 DNS | 换 Cloudflare / Google |
| `steamCDN` 列表 | Steam CDN 域名(直连解析) | 加新发现的 CDN |
| `proxyGroups` | 代理组定义 | 改名 / 改选择策略 |
| `healthCheck.interval` | 节点健康检查间隔 | 移动端调长省电 |
| `healthCheck.tolerance` | 延迟容忍 | 蜂窝网络调到 50 ms |

> 改完别忘了:中英两版同步改 + 改 CHANGELOG + commit + 视情况打 tag。

## Steam 直连三大原则(fake-ip 模式)

1. **规则顺序**:Steam 直连规则必须在广告规则集**之前**——首条命中即终止
2. **fake-ip-filter 边界**:Steam CDN 域名**不能**进此列表,否则 Clash 返回真实 IP 绕过 DOMAIN 规则链
3. **nameserver-policy 顺序**:Steam CDN 条目必须先于 `geosite:geolocation-!cn`,否则 `steamcontent.com` 经境外 DNS 解析返回境外 Akamai,直连必然失败

## 桌面 ↔ 移动差异(随时复习)

`Clash_script_mobile.js` 从桌面版**显式剥离**了:
- Steam CDN / 下载直连(桌面场景专属)
- `applications` 规则提供者(Android 上 selinux 隔离导致进程名匹配不可靠)
- 所有 `icon` 属性(桌面 GUI 扩展,移动端不渲染)
- IPv6(蜂窝 IPv6 路由频繁异常,默认关闭)
- 健康检查间隔调长(省电)
- 延迟容忍放宽到 50 ms(吸收蜂窝抖动)

并**新增**:
- captive-portal / connectivity-check 域名

## 版本管理

- **文件名稳定**:`_v1` / `_mobile` 是系列代号,不随小版本变化
- **版本演进**靠 [CHANGELOG.md](./CHANGELOG.md) + git tag
- 桌面 / 移动是**独立发布线**

| 客户端 | 当前 tag | commit |
|--------|---------|--------|
| Desktop (zh + en) | `desktop-v1.1` | `git log --decorate` |
| Mobile | `mobile-v1.0` | `git log --decorate` |

打 tag 与发版流程见 [AGENTS.md](./AGENTS.md)。

## 提交规范

Conventional Commits 简版:

| 前缀 | 用途 |
|------|------|
| `feat:` | 新规则、新功能 |
| `fix:` | 修复问题 |
| `refactor:` | 重构(不改变行为) |
| `perf:` | 性能优化 |
| `docs:` | 仅文档 |
| `chore:` | 杂项(初始化、配置) |

## 故障速查

| 症状 | 原因 | 排查 |
|------|------|------|
| Steam 下载 0 bps | nameserver-policy 顺序错 | 确认 `steamCDN` 在 `geosite:geolocation-!cn` 之前 |
| Steam 下载走代理 | Steam CDN 进了 fake-ip-filter | 检查 `fake-ip-filter` 列表 |
| 国内网站解析到境外 IP | 国内 DNS 不通 | 测试 `domesticNameservers` 里的 DoH |
| 移动端节点延迟狂跳 | 容忍阈值太严 | 调 `healthCheck.tolerance` 到 50+ ms |
| 日志报 `main is not defined` | 客户端没启用 JS 预处理 | Profile 设置里勾上 Script |
| Clash Verge 加载报语法错 | 文件被存为 CRLF | 仓库已强制 LF,确认你的编辑器存为 LF |

## 协议

[MIT](./LICENSE)
