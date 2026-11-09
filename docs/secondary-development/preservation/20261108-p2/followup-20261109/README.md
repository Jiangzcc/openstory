# P2 已知问题修正与补证（2026-11-09）

固定上游 B：2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0。复核起点 HEAD：2b41bbf33b75c66035dc0af08df6eea79e3de929。用户授权修复本轮复核发现的其它 P2 问题，Continue 文本来源漏传问题按用户明确决定暂缓。没有 fetch、合入上游、生产代码重构或商业功能实施。

## 修正范围

- AEG：修正 MCP 卡片、播放器、反馈/搜索、工程守卫/日志等 9 条错配，并补记 API 图片模型与 MCP storyboard 分析模型的输入契约变化，包含 API 伴随测试共 12 条路径更正。候选替换字段见 aeg-record-corrections.json，行为矩阵见 ../domains/behaviors-AEG.md。
- C：修正生成结果供应商落库、四类模式推荐、时长语言与辅助提示共 6 条映射或说明缺口。候选替换字段见 c-record-corrections.json，行为矩阵见 ../domains/behaviors-C.md。
- BD：纠正旧参考照片拒绝规则的修复提交引用，并缩窄凭证来源门禁的结论。历史引入提交与实际修复提交分别保留，见 bd-review.json 和 ../domains/validation-BD.json。
- 现有关键断言、源码和定向测试已有对应时补充链接；真正缺少供应商持久化回归时只补测试，不改变生成执行代码。实际测试变更及执行结果见 verification.json。

## 原断言对应

assertion-inventory.jsonl 从固定 B 与复核 HEAD 的 126 个已修改既有 test/spec blob 提取 expect 调用。34 个文件的 78 个原表达式不再完全相同；这是人工审查候选，不是 78 条断言丢失。两侧 Git blob、原行号和原表达式均可随检出核对，汇总与方法限制见 assertion-inventory-summary.json。

按实际变化分别补充 [AEG](assertion-trace-AEG.md)、[BD](assertion-trace-BD.md)、[C](assertion-trace-C.md) 和 [工程/E2E](assertion-trace-engineering.md) 的原保障、当前对应及有意变更依据。assertion-trace-index.json 将 34 个变更文件接回这些文档。表达式一致不能证明 setup、分支可达、时序及全部业务状态一致，自定义断言也不在本次 AST 工具的完整识别范围。

## 用户决定暂缓

[deferred-decisions.json](deferred-decisions.json) 的 CONTINUE-LLM-SOURCE 明确记录：组织 fal Key 可能使平台文本工作漏过余额检查，当前未修复；用户于 2026-11-09 决定待禁止用户配置 BYOK 时统一处理，故不是本轮整改的阻断项。组织无有效 fal Key 时，不触发已复现的豁免分支。全面禁止 BYOK 尚未实施，也没有借此删除原有组织/API/MCP 能力。

## 证据与结论边界

verification.json 记录本次真正执行的测试与完整性检查，test-results.jsonl 保留每文件和用例结果。2026-11-08 的 329 文件、4,588 项归档统计保持原值；本次定向测试单列，不重复累计或冒充全量复跑。原始 scope、merge、unit 和浏览器证据继续按原冻结点解释。

本次关闭的是已发现的台账错误、提交引用与定向证据缺口；逐行为结论以实际补证为准，不将路径状态或测试数量扩展为全部 1,128 路径所有运行状态已被重新证明。真实供应商/账单、远程 D1、Workflows 引擎重启、实际邮件和部署仍是原有环境边界。工作区既有 src/routeTree.gen.ts 不纳入本次修改。

本次定向验证最终按文件去重为 **19 个文件、388 项通过，0 失败、0 未执行**。首轮 generated-assets 的 DB 初始化 hook 超时使 11 项未执行，随后不改代码、不改超时地单独复跑全部通过；失败与重试分别保留。bun typecheck、新增测试的定向 type-aware lint 与格式检查通过。

完整性检查见 [integrity.json](integrity.json)，15 项全部通过；[一次性检查源码](integrity-check-source.txt) 随本次补证归档，不注册为 P4 持续门禁。检查涵盖候选分母/顺序、修正字段、原断言 blob、证据链接、历史统计和原工作区文件指纹。
