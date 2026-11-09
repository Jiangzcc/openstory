# P3 全量收敛设计的范围证据

日期：2026-11-09。状态：范围已冻结，职责设计与结构实施分别记录；生成清单不批准任何生产差异。

总设计见 [P3 全量收敛设计](../../upstream-preservation-p3-global-design-20261109.md)。本目录覆盖整个 fork 的当前差异，不随某次待合入的上游文件列表缩放。

## 固定版本

- 已合入纯上游基线 B：`2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0`。
- 本轮源码快照 S：`db3ea57b5f419f69c51369c28819de17515b21f5`。
- P2 历史审查源码 P：`ce321c885f67e40fec1c8598bb759790d89359c9`。
- 已验证 B 是 S 的祖先；本轮没有执行合并。
- 运行前已有的 `src/routeTree.gen.ts` 工作区修改单列保护，其 SHA-256 见 [scope.json](scope.json)，没有并入源码快照。

## 台账与可核对的分母

[scope.json](scope.json) 列出分片、行数、SHA-256、旧台账关联和原工作区摘要。范围为 B→S 的全部差异路径（关闭 rename 折叠），不是从历史候选或待合入上游交集推算出来。

| 分母                    |      数量 |
| ----------------------- | --------: |
| 全部路径                |     1,219 |
| 既有路径修改 / 新增路径 | 653 / 566 |
| 既有 src 修改 / 新 src  | 606 / 411 |
| 非 src 路径             |       202 |
| P2 已列路径             |     1,128 |
| P2 之后新增进入范围     |        91 |
| 旧范围内 P2 后又变化    |        27 |
| 旧范围内此后 blob 未变  |     1,101 |
| P2 路径退出当前差异     |         0 |

每个 JSONL 文件至多 400 行。`inventory-src-existing-*` 覆盖既有 src；`inventory-src-added-*` 覆盖新增 src；`inventory-support-*` 覆盖其他目录。新增文件同样接受职责与重复实现审查。

逐行字段：

- `baseBlob` / `headBlob`：真实 Git 对象标识；全零代表该版本没有该路径。
- `p2Blob`：P 版本的对象标识，不等同于 P2 已审查状态。
- `p2Association`：只保留旧台账 ID、owner 与 behaviorIds；`null` 表示当时未列入净差异范围，不代表文件在 P 不存在。
- `scopeDelta`：`unchanged-since-p2`、`revised-within-p2` 或 `new-to-scope`。
- `added` / `deleted`：B→S numstat；二进制为 null。
- `p3Disposition`：全部初始为 `pending`。旧 reviewed/tested 标签不直接带入 P3。

## 复核方法

在仓库根执行以下只读命令，可重建路径、类型、指纹与 P2 后变化。NUL 输出应由程序读取，不按空格拆路径。

```text
git merge-base 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 db3ea57b5f419f69c51369c28819de17515b21f5
git diff --raw --no-abbrev --no-renames -z 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 db3ea57b5f419f69c51369c28819de17515b21f5
git diff --numstat --no-renames -z 2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0 db3ea57b5f419f69c51369c28819de17515b21f5
git diff --raw --no-abbrev --no-renames -z ce321c885f67e40fec1c8598bb759790d89359c9 db3ea57b5f419f69c51369c28819de17515b21f5
```

核对 JSONL 无重复且与 Git 路径集合完全相等；按 path 比较 base/head 指纹及 numstat。再与 P2 的 [candidates](../20261108-p2/candidates.jsonl) 关联，不复制它的当前通过结论。历史 [merge-resolutions](../20261108-p2/merge-resolutions.jsonl) 277 对和 [historical-only](../20261108-p2/historical-only.jsonl) 7 路径保留为来源证据，其内容哈希在 scope.json。

## 职责设计与完成状态

四组 `.md` 描述调用链、目标边界及批次，配套 `.json` 索引及 `*-responsibilities.jsonl` 提供稳定职责编号、历史关联和验收条件；这些是拟实施设计。职责目录不能代替逐块处置。每批实施须补充实际改动、前后差异、原测试追溯和剩余待审项，才可关闭对应职责。

[prior-pilot-comparison.json](prior-pilot-comparison.json) 归档此前四个试点的反证：既有修改路径和同一上游样本的冲突数均未减少。它只纠正收益口径，不决定全量治理范围，也不是本轮运行验收。

本目录及其后实施都发生在 S 之后，属于各批交付增量；固定清单不会自称覆盖后来 HEAD。新增、恢复、改名与退场路径必须逐批追加，不能为维持 1,219 这个数字而漏记新差异。

## 全量职责与执行索引

- [roadmap.json](roadmap.json)：59项产品/工程职责与1项治理职责；66项候选/验证/未来触发动作，区分现有接口 gate 与 P4。
- [behavior-responsibilities.jsonl](behavior-responsibilities.jsonl)：79个历史行为号到职责的多对多归属提示。
- [scope-additions-responsibilities.jsonl](scope-additions-responsibilities.jsonl)：P2 后91个补充路径的明确归属提示。
- [roadmap-batches.jsonl](roadmap-batches.jsonl)：每项范围、动作、依赖与验收；第一实施批为 G09-reference-projection。

上述映射无孤项并不表示语义批准。原始 inventory 保持全部 pending，结构收益、原断言与实际验证须由实施逐批补齐。
