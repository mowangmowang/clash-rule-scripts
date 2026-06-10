# Clash 预处理脚本集

一组 JavaScript 预处理脚本,用于为 Clash 系列代理客户端注入 DNS、路由规则与代理组。
脚本作为「配置预处理器」运行,接收订阅源 YAML 转出的 JS 对象,返回增强后的最终配置。

## 文件清单

| 文件 | 适用客户端 | 语言 | 内部版本 | 行数 |
|------|-----------|------|---------|------|
| [`Clash_script_v1.js`](./Clash_script_v1.js) | Clash Verge Rev (桌面) | 中文注释 | v1.1 | ~886 |
| [`Clash_script_v1_en.js`](./Clash_script_v1_en.js) | Clash Verge Rev (桌面) | English comments | v1.1 | ~1011 |
| [`Clash_script_mobile.js`](./Clash_script_mobile.js) | Clash Meta for Android / Stash (iOS) | 中文注释 | v1.0 | ~801 |

## 桌面版 vs 移动版差异

`Clash_script_mobile.js` 从桌面版派生,显式剥离了以下桌面独有逻辑:

- **Steam CDN / 下载直连规则** — 桌面场景专属
- **`applications` 规则提供者** — Android 上 selinux 隔离导致进程名匹配不可靠
- **`icon` 属性** — 桌面 GUI 扩展,移动端不渲染
- **IPv6** — 蜂窝网络 IPv6 路由频繁异常,默认关闭
- **健康检查间隔** — 调长以减少移动端不必要的射频唤醒
- **延迟容忍** — 放宽到 50 ms 以吸收蜂窝抖动
- **新增移动端 captive-portal 与 connectivity-check 域名**

中英两版桌面脚本**保持功能完全一致**,仅注释语言不同。

## 安装与使用

1. 在 Clash Verge Rev(或 Clash Meta for Android / Stash)的「Profiles → 预处理」中启用 JS 预处理
2. 将本文件对应路径填入「预处理脚本路径」,文件名按上表选取
3. 在订阅源 YAML 之外,Clash Verge 会在加载时调用 `main(config)` 注入自定义规则

> 三个脚本**互不依赖**,可独立加载到不同客户端配置中。

## 三大核心原则(fake-ip 模式下 Steam 直连)

摘自主脚本注释,适用于所有桌面端 fake-ip 模式部署:

1. **规则顺序**:Steam 直连规则必须放在广告规则集**之前**——规则列表从上到下首个命中即终止。
2. **fake-ip-filter 边界**:Steam CDN 域名**不能**进入此列表,否则 Clash 返回真实 IP 绕过 DOMAIN 规则链。
3. **nameserver-policy 顺序**:Steam CDN 条目必须先于 `geosite:geolocation-!cn`,否则 `steamcontent.com` 等域名经境外 DNS 解析,直连必然失败。

## 版本管理

- **文件名稳定**:`_v1` / `_mobile` 后缀表示「脚本系列代号」,不随小版本变化
- **版本演进**通过 [CHANGELOG.md](./CHANGELOG.md) + Git tag 表达
- 桌面与移动是**独立发布线**,分别打 tag(见下表)

| 客户端 | 当前 tag | 说明 |
|--------|---------|------|
| Desktop (zh + en) | `desktop-v1.1` | Steam CDN 解析顺序修复 |
| Mobile | `mobile-v1.0` | 初始版本 |

打 tag 与发版的流程参见 `AGENTS.md` 中的「发布流程」一节。

## 提交规范

本仓库采用 [Conventional Commits](https://www.conventionalcommits.org/) 简版前缀:

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat:` | 新规则、新功能 | `feat(rules): 加入 Netflix 区域分流` |
| `fix:` | 修复问题 | `fix(dns): 调整 Steam CDN nameserver 顺序` |
| `refactor:` | 重构(不改变行为) | `refactor(groups): 合并重复代理组` |
| `perf:` | 性能优化 | `perf(rules): 合并可合并的 IP-CIDR 规则` |
| `docs:` | 仅文档变更 | `docs(readme): 更新三脚本对照表` |
| `chore:` | 杂项 | `chore: 初始化仓库元数据` |

## 协议

[MIT](./LICENSE)
