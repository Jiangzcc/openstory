# 图片渠道对抗性审查修复

日期：2026-11-07。修复基线：develop / 9e4e5f6f9。

## 原有行为与范围

上游已有组织钱包、图片生成、分镜编辑、Cloudflare Workflows 与 R2。本轮修复针对二开图片渠道接入中的六项审查发现，不新增商业计价体系、供应商接入或数据库结构。既有 USD / 微美元账务、生成后扣费节点、组织权限和未绑定内置模型的路由保持原有契约。

## 修复契约

1. 镜头再生成、变体网格和变体放大在预检及预占时使用子工作流实际携带的分辨率。再生成以已冻结的 workflowInput.resolution 为准，不重读当前模型选择。相同高分辨率任务不能先用低规格价建立预占，再让最终结算静默放弃费用差额。
2. 单张销售价必须精确表示为整数微美元。共享价卡解析在乘张数前校验单价，预估和实际收费都从整数单价乘数量；零价仍为明确的免费配置。供应商原币种成本不受销售价精度约束。历史配置仍可读取、纠正或停用；无效价卡在执行前拒绝，不静默改价。
3. Studio 继续使用既有 generate-image 持久化步骤名，并在步骤读取边界兼容旧的单个 upload 结果与当前 uploads 数组。恢复旧检查点不重新生成或存储图片，后续扣费仍使用原有幂等键。
4. 配置图片模型的分辨率来自当前操作已验证的尺寸能力，调用方传入动态图片目录。自定义身份和被绑定的内置身份采用同一规格推导，避免空档位把合法的 1080p 选择改为 720p。
5. 保存与执行共享参数名、标准枚举和操作适用范围。执行层不接受的已验证参数不能作为可用配置发布；安全标量扩展继续按原有能力声明使用。历史无效配置保留管理恢复入口，不能因配置校验而静默转到其它渠道。
6. 配置海报桥接层透传本地 Workflow 引擎中断，由工作流恢复机制处理；普通非关键海报失败仍允许主体流程继续。

## 接入与升级关注点

- 镜头生产代码仅补充分辨率透传，不重写既有大函数或改变 claim、幂等键和素材选择语义。
- 价卡解析、图片报价和结果计费保持现有领域边界，不改上游账务表、余额捕获策略或供应商成本语义。
- 持久化步骤输出属于跨部署接口；后续改变形状必须保留旧检查点读取能力，不能仅以当前类型检查代替回放验证。
- 参数与分辨率规则尽量放在客户端安全的共享模块，页面仅传入当前目录和用户选择。
- 上游变更图片工作流、规格控件、价卡接口和内容恢复路径时，需要重新核对这些桥接点。

## 验证

验证使用本地 Vitest、测试 D1 及明确标注的供应商 / 工作流派发 Mock。

- 图片渠道相关回归：52 个文件、797 项测试通过，使用 `--maxWorkers=4`。覆盖真实 D1 预占与并发结算、单价精度、参数保存与执行契约、规格选择及旧检查点回放。
- 架构边界：客户端 / 服务端边界、平台领域隔离、数据库访问白名单和工作流中途读取约束 4 个文件、78 项测试通过。`claim-discipline.test.ts` 在并行验证时有 1 项因冷导入超过原有 20 秒超时；隔离执行 `bun run test src/platform/server/workflow/claim-discipline.test.ts --maxWorkers=1` 后 5 项全部通过，未修改超时或断言。
- `bun typecheck`、全仓 `bun lint`、`bun dead-code` 和 `bun run build` 均通过。lint / 构建保留工具警告，knip 保留 5 条既有配置提示。
- 本轮 29 个修改或新增文件的 `bun run format:check` 通过，`git diff --check` 通过。
- 预占回归以移除三处修复的内存转换做反向验证，3 个 1080p 用例均在真实预占断言失败；磁盘生产代码未回退。

图片渠道回归选择与命令（PowerShell）：

```powershell
$imageFixTests = @(rg --files src/models src/billing src/stills src/studio src/sequences src/shots src/cast | Where-Object { $_ -match '(configured-image|compatible-image|image-channel|image-parameter-contract|image-model-catalog|image-model-schema|image-cost-hint|resolution-support|model-runtime-configuration|workflow-image-model-routing|shot-image-generation-billing|configured-poster|studio-generation-workflow|storyboard-workflow|sheet-portrait-step|preflight|workflow-deduction|image-generation-attempts).*\.test\.ts$' })
bun run test @imageFixTests --maxWorkers=4
```

没有付费供应商调用、远程数据库写入、部署或浏览器验收；本地断言不等于真实供应商及生产环境验收。历史无效配置仍可读取、纠正或停用，但不能启用或执行，不自动迁移参数或切换渠道。
