# 架构与开发

[返回仓库首页](../README.md)

## 运行架构

入口参考 [Script-Hub](https://github.com/Script-Hub-Org/Script-Hub)。用户只添加一份入口重写；静态托管仅用于提供首次安装与更新资源，没有运行时服务器。

```text
静态托管：qinglong-pusher.conf + qx/local.js + qx/capture.js + qx/backend.js
  └─ QX 拦截 https://qlpush.com
       ├─ 页面与 API → QX preferences
       ├─ /profiles/<app-id>.conf → 兼容旧订阅
       └─ QX http_backend 127.0.0.1:9999/qinglong-pusher/scripts/<app-id>.js
          → 规则头部 + 独立 App 抓取脚本
                                      ↓
                              直接同步青龙 Open API
```

入口脚本内置页面、校验和抓取源码。应用直接导入本地 JS，资源解析器从头部 `[rewrite_local]`、`[MITM]` 提取规则；规则引用同一 JS 地址，执行代码绑定 App ID。预览与保存后的下载共用生成器，用户配置不上传。

QX 自身下载订阅和 JS 是否能经过入口重写、是否发生脚本缓存或递归限制，必须用真实 iPhone 验证。当前模拟测试验证代码路由，不替代 QX 客户端兼容性证明。

## QX 本地路由

| 路由 | 用途 |
| :--- | :--- |
| `/`、`/app.js`、`/style.css`、`/core.js` | 内置 UI |
| `GET /api/status` | App 列表与非敏感状态 |
| `POST /api/preview` | 校验草稿并返回 JS / conf，不保存任何配置 |
| `POST /api/panel/test` | 使用已保存认证只读检查连接，不保存令牌或返回上游内容 |
| `POST /api/panel`、`POST /api/panel/delete` | 本机保存或清除认证，密钥不回传 |
| `POST /api/profiles` | 新建或更新单个 App |
| `POST /api/profiles/<id>/delete` | 删除单个 App |
| `GET /profiles/<id>.conf` | 动态独立重写 |
| `GET /scripts/<id>.js` | 带解析器规则头部的独立 App JS；新导入使用此地址 |

POST 需要同源 Origin、JSON Content-Type、`X-QP-Local: 1`，不开放 CORS。使用 `script-analyze-echo-response` 等待请求体，其他请求使用 `script-echo-response`。

```json
{
  "id": "app-example1",
  "title": "签到 App",
  "rules": [
    { "name": "APP_TOKEN", "url": "^https://api\\.example\\.com/user/.*$", "header": "authorization", "enabled": true }
  ]
}
```

## 仓库结构

```text
assets/                      README 等文档使用的静态素材
docs/                        使用、发布、开发和界面规范
scripts/
  build-release.js           静态发布入口
  check.js                   全量语法检查与测试入口
  generate-icons.js          PWA 图标生成工具
  lib/bundle.js              页面、共享代码和 QX 脚本打包
src/
  quantumult/                QX 本地控制台与抓取脚本
  server/                    开发预览服务与重写配置适配
  shared/                    跨 Node、浏览器和 QX 的校验及生成逻辑
  web/                       iPhone 页面、样式和 PWA 资源
tests/                       对应模块的 *.test.js 测试
release/                     构建输出，纳入版本控制，不手工编辑
```

目录与普通文件名使用小写连字符；保留 `README.md` 等通用约定。JavaScript 使用 ES modules、两空格缩进、UTF-8 和 LF，详见 `.editorconfig`、`.gitattributes`。QX 与浏览器源码通过打包共享，不在运行时导入 Node 模块。

`npm run check` 自动扫描 `src/`、`scripts/`、`tests/` 的全部 JavaScript 并执行测试；新增文件无需手动扩展命令。源码目录调整不改变 `/qx/local.js`、`/sw.js` 等公开路由和发布文件名。

## 开发与维护

```sh
npm run check
npm start
```

- [静态发布说明](publishing.md)面向维护者；不要把服务器部署作为用户安装前提。
- UI 遵循[界面与交互规范](ui-guidelines.md)，并执行移动端回归清单。
- 修改路由、配置格式时同步更新文档和测试，验证多 App 隔离。
- 测试只使用合成数据，不读取真实设备或青龙凭据。不要提交 Cookie、密钥、访问令牌或未脱敏的日志。
- 未确认发布地址前不提供虚假安装链接；不自动提交或推送。

## PWA 资源

`src/web/pwa.js` 管理安装提示与更新，`src/web/sw.js` 严格白名单缓存界面资源。`scripts/lib/bundle.js` 注入内容哈希生成缓存版本，将 manifest、Service Worker、安装脚本与内嵌 PNG 图标一起打包供 QX 本地应答。

`npm run icons` 重新生成 `src/web/pwa-icons.json`（180 / 192 / 512px）；不依赖图片 CDN。不要把 `/api/*`、`/profiles/*`、`/scripts/*` 加入缓存，也不要把认证或配置塞进 manifest、URL 或 Service Worker。

测试包括 manifest/PNG 校验、缓存路由隔离，以及浏览器断网加载与编辑禁用。iOS 安装验收仍需真实设备。

`src/quantumult/backend.js` 是仅提供 JS 的独立后端，不提供控制台 API。构建将其与共享校验、抓取源打包到 `qx/backend.js`，同一入口 conf 声明 `[http_backend]`。旧 HTTPS JS 路由兼容手动访问，新的导入和头部执行地址只使用 loopback。
