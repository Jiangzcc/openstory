# G09 六项缺口修复（2026-11-13）

本批按用户明确授权修复六项已确认问题，状态为 repaired-with-bounded-evidence。实施目录为 D:/code/github/openstory，分支 develop；本轮 before 为 637a7521ff56618af342046084078ff2a7d6f91c，代码提交为 9c51bfb82a201120ea404f9065ddd4af3ad9001e。固定上游 B 和冻结设计 S 未移动。用户已授权为这六项调整原 GC-09 停止边界；[上一轮审查](../20261113-p3-g09/README.md)及红灯归档保持原始字节。

## 原因、结果与接入点

| 问题                  | 原有缺口                                    | 修复                                                                                            |
| --------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| G09-LOC-01            | 分析绑定已有地点时未验证 sequence 所属组织  | 原 bind 复用 requireSequence，在 link 读写前拒绝外组织序列                                      |
| G09-LOC-02            | 外组织 sheet 完成在抛错前已追加历史         | 原版本入口先验证父地点，拒绝时历史不变、原 claim 仍可完成                                       |
| G09-LOC-03            | divergent 插入/已有行读取缺归属证明         | 先验证父地点，既有行查询按组织限制；保留幂等和竞争重试                                          |
| G09-LOC-04            | 纯中文名称经 ASCII slug 得到空 tag          | stored tag、原非空 ASCII slug 优先，仍为空时用 Unicode 字母/数字回退                            |
| G09-LOC-05            | ASCII tokenizer 清空中文正文，漏选地点      | 英文候选之后匹配完整汉字名称，保留显式 tag/sceneLocation 优先级                                 |
| G09-UPSTREAM-GUARD-01 | 草稿视觉请求无归属/权利 gate 就进入付费工作 | 原 handler 复用 requireCheckable/requireUploadRights，在配置、key、余额、vision、扣费前等待检查 |

这些规则属于原 entity/link/request/reference owner。先写历史或调用供应商后再补校验无法修复根因，因此本批只在五个既有生产接入点调整，不扩大通用生成器或复制保护规则。共享 landing、claim、schema 与 hash 算法未改。升级时复核[实现映射](implementation.json)中的五处；不据本批宣称冲突文件减少或 P3 整体结束。

## 中文匹配与 hash 兼容

非空已存 tag 原样返回，原有非空英文回退不变；全局 slugifyTag、identityToken 和 tokenize 未改。正文要求完整汉字名称，混合名称不能只凭英文片段误选。多个候选仍选择一个最具体地点；显式 tag/sceneLocation 仍优先。

地点 sheet hash 不读取 consistencyTag。英文和已有明确单地点路径的改前固定 prompt 摘要、固定 sheet 摘要均通过；无 stored tag 但已由 sceneLocation 选中的中文地点也保持选择与 hash。原来漏选的中文正文地点现在会进入依赖，多个已标记地点也可能按中文镜头正文缩小集合，相关 prompt/still/clip hash 可能变化，使旧产物按现有规则读作 stale。没有迁移或改写已存 tag/hash，不能概括为所有旧记录零变化。所读字段和依赖边未变，交互图无需增删边。

## 验证与保留

- 修复前地点 9 项为 4 通过、5 失败；恢复到常规测试的文件与旧探针逐字节一致，修复后 9 项全过。
- 草稿 11 项在固定旧 handler 上为 5 通过、6 失败，修复后全过；六个失败场景覆盖同一个请求保护缺口，不算成另六个问题。
- 一次整合 48 文件、857 项全过、零跳过：原 34 文件 494 项、上一轮新增 14 项、地点诊断 9 项、DB 新增 8 项、草稿 11 项、canonical/匹配两文件 80 项、其它 reference/hash 回归 241 项。worker 定向检查、复跑、基线与 hooks 不重复累计。
- 当前源码的新 bun run build、全仓 bun typecheck/bun lint、本次 14 文件格式检查通过。146 条 lint 警告与上一轮归档按去除行列偏移的消息逐条一致，没有新增；locations.ts 的既有警告因新增一行顺移。
- 正常代码提交 hooks 的 client-server-boundary、dead-code、format、lint、typecheck 全通过，耗时 108.45 秒，未绕过。日志摘要/hash 见[验证记录](verification-results.json)。
- [保留证明](source-preservation.json)验证原 34 测试、两个扩展测试的原测试体、25 冻结文件、13 个上轮归档和台账前 11 行；1,219 项 inventory 继续全部 pending，仅追加第 12 行。

测试使用真实本地 D1 adapter、scoped-db、claim/promotion、选择器和 hash。草稿入口执行实际 handler 与真实 ledger，但 Start builder/可信身份、供应商、凭证、余额/扣费为显式替身。未做 HTTP/浏览器、真实 R2/供应商/实际扣费、远程 D1 或 Cloudflare 持久重放验收。本批只本地提交，不推送、不部署。

初版草稿 test adapter 缺少 createServerOnlyFn 导出导致零测试收集失败，保留真实 Start 导出后修正；初版 Node runner 无法直接 spawn Windows Bun shim，随后改用其实际 bun.exe。两类基础设施失败均不算业务成绩。新文档两处格式问题由正常 oxfmt 修正。[修复前结果](baseline-results.json)记录边界；旧草稿复现脚本仍校验历史源 hash，不为适配新实现修改。

## 重跑与剩余事项

在当前仓库根执行：

```powershell
$tests = Get-Content docs/secondary-development/preservation/20261113-p3-g09-repair/test-files.txt
bun run test @tests --maxWorkers=1
bun typecheck
bun lint
bun run build
```

也可运行 node docs/secondary-development/preservation/20261113-p3-g09-repair/run-regressions.mjs：它调用同一本地 Vitest 入口并读取未修改的根配置，不用 Bun 内置 test runner。

六项有限本地修复完成；GC-09 其它职责、G03 生命周期领域覆盖/原冷导入超时/真实持久重放、G07 music hold 与 motion/reference 价格风险及其它 P3 工作仍开放。CONTINUE-LLM-SOURCE 按用户决定暂缓，不夹带 BYOK 商业禁用、人民币钱包或账本迁移。P3 整体进行中，P4 未开始。
