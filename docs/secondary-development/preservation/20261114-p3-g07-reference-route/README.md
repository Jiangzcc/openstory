# G07 motion 引用路由估价修复（2026-11-14）

本批继续执行 P3 的 G07，修复 smart retry 和 add-video-model 在 motion 预占时没有按实际可绑定引用判断生成 endpoint 的问题。此前两处入口已经构造了每个 shot 的 `referenceImages`，但 smart retry 没有传 `hasReferenceImages`，add-video-model 只用组织里是否存在角色/元素作为近似值；这会漏掉普通角色引用、地点-only 的 reference-only shot，也会把 endpoint 无法承载的引用算进去。

## 根因和改动

motion 提交侧已经用以下事实决定 fal 路由：

- 当前模型是否有 reference-to-video endpoint；
- 当前 shot 的引用经过该 endpoint 的类型、数量、合并上限和媒体时长规则后，是否仍有引用可以上 wire；
- 起始帧是否占用一个 image slot。

预占入口以前没有复用这条投影，所以同一个请求可能按 image-to-video 或错误的 reference-only 路径估价，而提交时进入另一张价格卡。本批在 `src/motion/server/build-motion-references.ts` 增加 `hasBindableMotionReferences`，复用 `bindableReferences` 和 `getMotionReferenceEndpoint`，然后让 smart retry 与 add-video-model 对每个 shot 使用实际引用和实际起始帧状态计算 `hasReferenceImages`。

改动保持以下边界：

- 不改变 `resolveMotionEndpoint`、供应商提交、claim、reservation ownership、workflow payload 或失败清理时序；
- 不在模型/供应商之间静默回退；
- 仅修复当前预占估价对 fal endpoint 的路由投影，不把平台 native via 的最终成本规则臆造为 fal 价卡。

## 回归与验证

新增/补强：

- `src/motion/server/build-motion-references.test.ts`：覆盖地点-only reference-only 引用以及 endpoint 无法绑定的媒体；
- `src/sequences/smart-retry.test.ts`：smart retry 的角色引用实际走 reference-to-video 价卡；
- `src/sequences/server/add-video-model.test.ts`：add-video-model 使用工作流实际引用计算预占，并保留 payload 引用。

定向命令：

    bun run test src/motion/server/build-motion-references.test.ts src/sequences/smart-retry.test.ts src/sequences/server/add-video-model.test.ts

结果为 3 个测试文件、45 项通过。另通过：

- `bun typecheck`；
- `bun lint`（仓库既有 warning）；
- `bun run build`；
- `bunx oxfmt --check`（本批修改文件）；
- `git diff --check`；
- 正常 pre-commit hooks，未绕过。

本批没有执行真实 native/fal 供应商、真实价单/账单、Cloudflare durable replay、远程 D1/R2、浏览器 HTTP 或钱包结算。

## 状态和边界

本批关闭 `INHERITED-MOTION-REFERENCE-ROUTE` 在当前 fal 预占入口上的代码缺口，但不关闭 GC-07。native xAI/Google/BytePlus 的实际路由与最终成本归属、真实供应商账单、durable replay 和生产结算仍需单独验收；历史 `20261110-p3-g07-callers/inherited-risks.json` 保留原始 characterization，当前修复证据以本批记录为准。
