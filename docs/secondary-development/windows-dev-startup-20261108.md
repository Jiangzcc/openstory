# Windows 本地启动检查器连接重置

日期：2026-11-08。范围：`develop` 的本地 Vite / Workerd 启动兼容适配。

## 原有行为与复现

上游 Cloudflare Vite 插件默认启用 Worker 检查器。本机执行 `bun dev` 时，本地 D1 迁移、seed 和内容集合构建通过，随后以 `TypeError: fetch failed` / `read ECONNRESET` 退出。

临时诊断脚本捕获到失败请求为 `GET http://127.0.0.1:<随机端口>/json`，调用链为 Miniflare `InspectorProxyController.updateConnection` → `CloudflareDevEnvironment.initRunner`。这是本机 Workerd 检查器的初始化请求，并非供应商或远程数据库请求。诊断脚本只在系统临时目录运行，没有加入应用。

当时安装版本为 Node 26.13.0、`@cloudflare/vite-plugin` 1.67.0、Miniflare 5.20261101.0-beta。独立的最小 Miniflare 检查器请求能够成功，因此不能认定所有 Windows 环境必现，也未确认连接重置的底层原因。

## 最小适配及影响

在 `vite.config.ts` 的 `cloudflare()` 组装入口使用公开选项：

```typescript
inspectorPort: process.platform === 'win32' ? false : undefined,
```

Windows 下关闭本地 Worker 检查器，绕过已捕获的失败请求；其他平台保留插件默认行为。固定外层检查器端口不能消除内部随机端口的请求。未修改依赖、Miniflare 源码、Wrangler 绑定或业务调用链。

这是本项目的开发环境适配，不是新增产品能力。Windows 的 `bun dev` 及直接 `vite preview` 暂停该 Worker 断点调试入口；浏览器开发者工具不受此选项控制。独立的 `bun cf:dev` 使用 Wrangler，不读取此 Vite 插件选项。该选项不进入生产 Worker 配置。

上游升级需复核 `vite.config.ts` 的 `cloudflare()` 接入点、插件的 `inspectorPort` 契约及 Windows 实际启动情况；恢复默认检查器前应在本机复验。非 Windows 目前只有配置及源码审查证据，尚未进行跨系统实测。

## 本轮验证

- 修改文件的 oxfmt 检查通过。
- 修改文件的 type-aware oxlint 无错误；保留该文件原有的 `this.environment?.name` 冗余可选链警告。
- 全项目 `bun typecheck` 通过。
- 原命令 `bun dev` 完整启动通过，Vite 监听 `http://localhost:3000/`；本次冷启动初始化耗时 401032 ms。
- 启动横幅确认 D1 和两个 R2 绑定均为本地模拟；`GET /login` 返回 HTTP 200，首次请求耗时约 14.56 秒。
- 验证后已停止本次启动的进程，释放端口供用户再次执行 `bun dev`。

没有执行付费模型调用、真实邮件发送、部署或远程数据库操作。
