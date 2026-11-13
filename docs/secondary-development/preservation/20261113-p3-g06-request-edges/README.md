# P3 G06-request-edges：API 创建请求边界快照（2026-11-13）

本批起点为 7e4bb7384，代码提交为 57824149d。本批承接 G06-capture 与 G06-auxiliary，只处理同一个 API 创建请求中仍会重新读取模型配置的两条边：脚本增强和内联地点设定图。

## 根因与修复

API 一次性创建在请求开始已经捕获完整 ModelRuntimeConfiguration，并将它交给默认值解析、共享创建核心和 storyboard。可选脚本增强仍在共享增强器内部重新读取文本渠道和模型目录，因此管理员在增强前后修改配置时，增强与后续 storyboard 可能使用不同模型、渠道、凭证引用或费率。本批给增强器增加可信内部可选快照；有快照时只消费它，没有快照时保留原有独立入口 loader。

API 创建的内联地点为了避免在序列失败前收费，会在序列成功后才启动地点设定图。此前该根任务在 regenerateLocationSheet 内部重新加载当前配置。本批把同一可信快照沿 triggerOrganizationLocationSheet 传到地点设定图的报价和 workflow trigger；地点创建、序列成功后派发、失败非致命和直接地点入口的 fallback 都保持。

没有向公开 schema 增加配置字段，也没有改变独立 dashboard enhancement、地点详情、upload-check、element vision 或 element-sheet 子任务的根归属；没有增加 ownsReservation 传播。

## 入口处置

- API enhancement：同次创建复用请求开始捕获的配置。
- API location sheet：同次创建复用同一配置，仍在 create core 成功后启动。
- 独立 enhancement/location 请求：无共享前置决策，继续由各自入口一次捕获。
- create core、元素 vision、upload-check、element-sheet、full retry/regenerate：沿用上一批已验证的快照或独立根边界。

完整入口矩阵见 caller-matrix.json，实现范围见 implementation.json。

## 验证

最终固定集合为 48 个测试文件、930 项，全部通过；类型检查、lint、生产构建、格式检查、diff 检查及正常 pre-commit hooks 通过。lint、build 和 knip 的既有 warning/hint 没有作为本批错误。详细命令和未运行的真实环境见 verification-results.json。

本批没有调用真实供应商、真实 Workerd 持久重放、远程 D1/R2、真实结算或部署。GC-06 整职责、P3 整体以及 1,219 条冻结 inventory disposition 仍保持开放/pending，P4 未开始。
