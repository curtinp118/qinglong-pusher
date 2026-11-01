![qinglong-pusher](https://socialify.git.ci/curtinp118/qinglong-pusher/image?custom_description=%E9%9D%92%E9%BE%99%E9%9D%A2%E6%9D%BF%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F%E8%87%AA%E5%8A%A8%E6%8E%A8%E9%80%81%E5%8A%A9%E6%89%8B&description=1&font=JetBrains+Mono&forks=1&issues=1&language=1&name=1&owner=1&pulls=1&stargazers=1&theme=Dark)

<p align="center">
  <a href="https://github.com/crossutility/Quantumult-X"><img src="https://img.shields.io/badge/Quantumult_X-0078D4?style=for-the-badge" alt="运行环境：Quantumult X"></a>
  <a href="docs/usage.md#pwa添加到主屏幕"><img src="https://img.shields.io/badge/PWA-主屏幕应用-315EE7?style=for-the-badge" alt="PWA 主屏幕支持"></a>
</p>


---

## 项目简介

**qinglong-pusher 是面向 iPhone  Quantumult X 用户 捕获指定请求头，自动同步青龙环境变量。**

添加入口重写后，在 `qlpush.com` 管理青龙认证、应用规则、JS 预览与独立订阅。用户无需部署服务器、运行 Node.js 或配置 DNS；维护者只需发布静态安装文件。



## 安装与使用

### 前置要求：KOP-XIAO 资源解析器

> [!IMPORTANT]
> **本项目的一键导入需要使用 KOP-XIAO 资源解析器。** 应用订阅通过 `#replace=` 参数在本机生成重写规则；仅开启「资源解析器」开关，不代表已经配置了所需解析器。

在 QX 主配置已有的 `[general]` 段中设置或更新此项，不要重复添加同名配置段：

```ini
resource_parser_url = https://raw.githubusercontent.com/KOP-XIAO/QuantumultX/master/Scripts/resource-parser.js
```

- 不要使用 GitHub 的 `/blob/` 文件展示页地址。
- 解析器为全局设置；若已有其他解析器，请先确认更换后不会影响其他订阅。
- 导入本项目的应用资源时，保持「资源解析器」开启（导入链接默认携带 `opt-parser=true`）。
- 导入后应显示目标 App 的 URL 规则与 MitM 域名；若仍出现 `qp-template.invalid`，说明模板未正确解析，请检查解析器地址、更新状态和开关。

### 1. 安装入口

将以下订阅地址添加到 **Quantumult X → 重写 → 引用资源**：

```text
https://raw.githubusercontent.com/curtinp118/qinglong-pusher/main/release/qinglong-pusher.conf
```

启用该资源、重写与 **MitM**，并完成 QX 证书的安装与信任。无需配置本地后端。应用订阅使用 GitHub 静态模板与 KOP-XIAO 解析器的 `#replace=` 参数，执行 JS 也从 GitHub 下载；控制台继续使用 HTTPS。

修改应用 URL 后需重新导入并移除旧同名资源；刷新旧订阅不会读取控制台中新修改的规则。

保持 QX 开启，在 iPhone Safari 中访问 **[https://qlpush.com/](https://qlpush.com/)**，进入配置页面。

> [!WARNING]
> `qlpush.com` 是由 QX 拦截的本地入口，不是本项目运营的公网服务。只有入口重写正常工作时页面才由本机响应。未确认拦截成功前，不要在该域名填写青龙凭据。

### 2. 配置青龙

在 **设置 → 青龙面板** 填写 HTTPS 面板地址、Client ID 与 Client Secret。先在青龙的应用设置中为该应用授予环境变量权限，再保存并点击「测试连接」。

- **绿灯**表示本次认证与环境变量读取成功，不代表写入权限已验证。
- 密钥仅保存在本机 QX，不回显；相同地址和 Client ID 下留空可保留原密钥。
- 修改配置后需重新保存、测试。成功状态显示时间，5 分钟后失效。

### 3. 新建应用并导入

| 新建 | 预览与保存 | 导入与同步 |
| :--- | :--- | :--- |
| 填写应用名、青龙变量名、URL 正则、请求头名称 | 点击「预览 JS」，检查源码后明确确认保存 | 在应用列表点击「导入 QX」，按客户端提示确认，再打开目标 App 触发请求 |

**预览不保存，关闭不保存。** 返回编辑、右上角关闭或点击遮罩只关闭预览；确认保存才更新应用配置。应用列表同时提供「导入 QX」与「删除」。

删除应用会阻止后续抓取执行；仍需在 QX 移除对应重写，不会删除青龙已有变量，也不能撤回正在执行的请求。



## URL 正则

输入以 `^` 开头的表达式，不加 `/…/g` 等定界符和标志。例如匹配普通签到接口、可选的 `-day` 后缀及查询参数：

```regex
^https://api\.example\.com/user/sign-in(-day)?(\?.*)?$
```

- 域名必须固定，点写作 `\.`；协议支持 `http`、`https`、`https?`。
- 路径支持字符类、分组、字符量词与可选分组 `(...)?`。匹配任意路径内容用 `.*`，不是单独的 `*`。
- 最长 500 字符；不支持环视、反向引用、顶层分支或分组后 `*`、`+`、`{n}` 重复量词。

正则性能与 QX 引擎兼容性仍需实际请求验证；尽量限定路径范围。更多示例和旧规则兼容说明见[URL 正则示例](docs/usage.md#url-正则示例)。

## PWA 主屏幕

在开启 QX 的 iPhone 上，通过 Safari 访问本地控制台，选择 **分享 → 添加到主屏幕**。不要把电脑上的 `localhost` 开发预览作为正式应用安装。

离线缓存仅包含界面资源，不等于离线同步。QX 入口不可用时，页面不能读取配置或保存更改；连接测试和同步仍依赖网络。启动、回到前台及保持前台时会检查更新，也可在设置中手动检查；确认后切换新版并刷新，未保存编辑时禁止更新。页面内置于 QX 脚本，发布后需先更新入口脚本缓存。

## 数据与安全

> [!WARNING]
> Cookie、Token 和密钥属于敏感信息。不要提交到仓库，不要分享未脱敏截图、抓包或备份，也不要把真实凭据填写到 URL 正则中。

- **本机配置**：规则和青龙认证存储在 QX preferences。密钥不会写入订阅或生成的 JS；preferences 并非加密保险箱，请保护设备与备份。
- **直接请求**：QX 直接调用青龙 HTTPS Open API，不经静态分发站点中转；保持证书校验，禁用自动 Cookie 和重定向。
- **最小留存**：不持久化捕获值或访问令牌；除写入目标青龙变量外，捕获值只在运行时处理。
- **授权使用**：仅处理本人或已获授权的账号与流量，按需添加 MitM 域名，不绕过应用证书固定。
