# AGENTS.md — AI 协作备忘

> 本文件供 opencode / Cursor / Claude Code / Copilot 等 AI 助手在进入本目录时阅读,
> 帮助快速理解项目约定,避免重复摸索。

## 项目性质

一组 **Clash 代理客户端配置预处理脚本**(JavaScript),不是 Node.js 应用。
脚本由 Clash 客户端的「配置预处理」引擎加载,接收订阅源 YAML 转出的对象,
在内存中增强 DNS / 路由 / 代理组配置后返回。

## 文件地图

| 文件 | 用途 | 修改频率 |
|------|------|---------|
| `Clash_script_v1.js` | 桌面版(中文) | 偶发 |
| `Clash_script_v1_en.js` | 桌面版(英文,与中文版**功能完全一致**) | 偶发,**必须与中文版同步** |
| `Clash_script_mobile.js` | 移动版(从桌面版派生) | 偶发 |
| `ClashScript_ForBettbox.js` | Bettbox(FlClash core)版,带分组开关与回退链(从移动版派生) | 偶发 |
| `README.md` / `README_EN.md` | 项目说明(中/英) | 偶发 |
| `CHANGELOG.md` | 版本历史 | 每次发版必改 |
| `.gitattributes` | 强制 LF | 几乎不改 |
| `.gitignore` | OS / 编辑器忽略 | 几乎不改 |
| `LICENSE` | MIT 协议 | 几乎不改 |
| `AGENTS.md` | 本文件 | 偶发 |

## 修改规范

### 四脚本同步(强约束)

`Clash_script_v1.js` / `Clash_script_v1_en.js` **必须**功能一致(仅注释语言不同);
`Clash_script_mobile.js` 从桌面版派生(剥离 Steam/进程名/图标);`ClashScript_ForBettbox.js` 从移动版派生,额外维护分组开关与回退链。
功能变更时:

1. 先改中文版 `Clash_script_v1.js`,确认无误
2. 再同步改英文版 `Clash_script_v1_en.js`,**逐段对照**(英文版注释更详尽,可能包含中文版未提及的边界说明)
3. 判断该功能是否适用于移动端:适用则同步改 `Clash_script_mobile.js`
4. Bettbox 版 `ClashScript_ForBettbox.js`:同步功能改动,并确认新分组已加入 `ruleOptionsEnable`、`serviceConfigs`(带 `fallback`)和 `knownGroupNames`
5. 一次 commit 包含所有受影响文件

### 桌面 → 移动派生规则

修改桌面版后,问自己:**这条规则在移动端还有意义吗?**

桌面独有、移动端**应剥离**:
- Steam CDN / 下载直连
- 进程名匹配(`applications` rule-provider)
- `icon` 属性
- 桌面 GUI 扩展

移动端**应新增**:
- captive-portal / connectivity-check 域名
- 电池友好型 health-check 间隔
- IPv6 默认关闭

Bettbox 版(在移动版基础上)**应额外维护**:
- `ruleOptionsEnable`:每个可开关分组的默认开关
- `serviceConfigs`:每个可开关分组的 `icon` 与 `fallback`(关闭后规则回退目标)
- `knownGroupNames`:新分组名必须加入,否则代理引用清理器会把它当未知引用删除
- 回退链终点必须是始终存在的组(如 `Fallback` / `DIRECT`),不能指向另一个可能被关闭的组而形成断链

### 不要做的事

- ❌ **不要把订阅 URL、token、密码写进任何 JS 文件**。订阅源由 Clash 客户端在运行时注入,脚本只负责加工。
- ❌ **不要引入 npm 依赖**。脚本在 Clash 内嵌 JS 引擎中运行,没有 `require` 能力。
- ❌ **不要在脚本里使用 ESM(`import`/`export`)**。Clash 内置引擎是 CommonJS-only。
- ❌ **不要修改文件名的 `_v1` / `_mobile` 后缀**。它们是脚本系列代号,通过 git tag + CHANGELOG 表达版本演进。
- ❌ **不要把 CRLF 换行符混进 JS 文件**。`.gitattributes` 已强制 LF。

## 测试方法

本仓库**没有自动化测试**。修改后的验证流程:

1. 把脚本路径填进 Clash Verge Rev 的「配置预处理」
2. 加载一个订阅源,观察:
   - 代理组数量与命名是否符合预期
   - DNS 解析查询是否走预期的 DoH 服务器
   - 日志中无 JS 异常
3. 移动版:在 Clash Meta for Android 或 Stash 中同样操作
4. Bettbox 版:逐个关闭/开启 `ruleOptionsEnable` 中的分组,确认被关组不生成、指向它的规则沿 `serviceConfigs` 回退链正确回退、无悬空引用或空组
5. 桌面版 fake-ip 模式下,启动 Steam 下载并观察速度(应达到带宽上限)

## 发布流程

每次有意义的变更后,按以下顺序操作:

```bash
# 1. 改代码 + 写 CHANGELOG.md(可分开两个 commit,也可合并)
git add <修改的文件>
git commit -m "<类型>: <简述>"

# 2. 同步中英 README(若功能/分组有变化)
git add README.md README_EN.md
git commit -m "docs: update README for <version>"

# 3. 如果改了 CHANGELOG,单独再提交一次
git add CHANGELOG.md
git commit -m "docs(changelog): 记录 <version> 变更"

# 4. 打 tag
git tag desktop-v1.2 -m "Desktop v1.2: <变更简述>"
# 或
git tag mobile-v1.2  -m "Mobile v1.2: <变更简述>"
# Bettbox 版不单独打 tag,随移动版发布线发布

# 5. (将来推送时)
git push origin main --tags
```

**版本号规则(SemVer):**
- `MAJOR`:不兼容的配置结构变化(需手动迁移)
- `MINOR`:新增规则 / 代理组(向后兼容)
- `PATCH`:修复 / 顺序调整(向后兼容)

桌面与移动是**独立发布线**,互不阻塞。

## Git 工具约定

- 提交信息:Conventional Commits 简版(`feat` / `fix` / `refactor` / `perf` / `docs` / `chore`)
- 分支:`main` only;4 个脚本不需要 dev / feature 分支
- 远程:本仓库 origin = `https://github.com/mowangmowang/clash-rule-scripts.git`,**已配置**。直接 `git push origin main --tags` 即可推送
- 换行符:仓库内统一 LF。链式配置(从内到外):
  1. `.gitattributes` 写 `*.js text eol=lf` — 仓库内对所有 .js 强制 LF
  2. `git config --local core.autocrlf false` — 仓库内禁用 git 自身的 CRLF↔LF 转换,让 `.gitattributes` 单独说了算
  3. `git config --global core.autocrlf input` — 全局默认,适合新仓库
  - 之所以要在 `local` 设 `false`:Windows Git for Windows 在系统级 (`E:\Git\etc\gitconfig`) 把 `autocrlf` 强制设为 `true`,会覆盖 global 的 `input`,把已 LF 的文件存成 CRLF。仓库级 `false` 是显式兜底
  - 如果换机器或重装 Git,请先确认 `git config --show-origin --get core.autocrlf` 看到的是 `input` 或 `false`,不是 `true`
