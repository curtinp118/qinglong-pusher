# 安装与静态发布

[返回仓库首页](../README.md)

## 用户安装

1. 将本仓库发布的 [`qinglong-pusher.conf`](https://raw.githubusercontent.com/curtinp118/qinglong-pusher/main/release/qinglong-pusher.conf) 地址添加到 QX 重写引用。
2. 启用重写与 MitM，安装并信任 QX 证书。
3. 在开启 QX 的 iPhone 上访问 [https://qlpush.com/](https://qlpush.com/)。

无需安装 Node.js、启动服务、部署容器或配置 DNS。入口脚本包含页面、API、配置生成和抓取脚本源码，均在 QX 中执行。青龙认证在本地控制台「设置 → 青龙面板」独立配置；[详细配置](usage.md)。

> [!IMPORTANT]
> `qlpush.com` 是 QX 拦截入口，不是公网服务。必须先安装重写。QX 内部订阅和脚本下载能否经过重写拦截需要实机验证；不能仅凭浏览器模拟宣称已支持所有 QX 版本。

## 维护者发布

Node.js 22+ 仅用于开发、测试和一次性打包，不需要常驻进程。

```sh
npm run check
npm run build -- https://raw.githubusercontent.com/curtinp118/qinglong-pusher/main/release
```

仓库为 [curtinp118/qinglong-pusher](https://github.com/curtinp118/qinglong-pusher)，默认分支为 `main`，静态资源位于 `release/`。Fork 时修改命令中的账号、仓库和分支；不得使用本地拦截域名 `qlpush.com` 或携带认证凭据。

输出结构：

```text
release/
  qinglong-pusher.conf
  qx/local.js
```

把两个文件按此目录结构上传到所指定的地址，用户只添加其中的 `qinglong-pusher.conf`。入口文件已引用完整静态脚本 URL，不需要后端 API 或动态路由。可传第二个参数指定输出目录；默认 `release/` 已被 Git 忽略；使用本仓库 Raw 发布时，须在审核生成内容后显式添加这两个文件（`git add -f release/qinglong-pusher.conf release/qx/local.js`），发布到 `main` 分支。不要上传调试文件或凭据。

已确认远端仓库存在且默认分支为 `main`；本次检查两个安装资源地址均返回 404，需先上传发布文件。上述链接是确定的发布目标，不表示已可安装。构建不会配置 Git remote，也不会自动上传、提交或推送。

页面更新后重新打包并上传静态脚本，用户刷新入口资源及其脚本缓存。入口需保持启用；各 App 订阅和抓取 JS 依赖它在本机响应。

## 开发预览

```sh
npm start
```

打开 `http://localhost:8787`。这只是开发用预览，生成 JS 但不执行它，不把配置保存到 QX。普通用户无需运行此命令。

`HOST`、`PORT`、`PUBLIC_BASE_URL` 只影响开发预览服务。默认 `127.0.0.1:8787`，公共 origin 默认 `http://localhost:8787`；不支持子路径。通过与所设 origin 一致的地址打开页面，避免同源保护拒绝请求。
