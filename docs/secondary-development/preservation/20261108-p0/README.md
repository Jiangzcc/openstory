# P0 固定范围与候选清单

执行日期：2026-11-08。此目录是固定起点的审查输入，不是全范围保真通过证明。

本批执行 [保留计划](../../upstream-preservation-plan.md) 的 P0、P1。P0 冻结执行起点，P1 的实际纠正、提交和验证另记在 [实施记录](../../upstream-preservation-p0-p1-20261108.md)。本目录不随 P1 提交重新生成，避免执行起点悄悄前移。

## 固定引用

| 对象                | 固定值                                     |
| ------------------- | ------------------------------------------ |
| 纯上游已合入基线 B  | `2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0` |
| 历史审查起点        | `b4973d7fb1f563b5181970388d810bc147e60263` |
| P0/P1 执行起点 L    | `a1dd140dabd381a35366a0d6404b3b4c55cdf700` |
| 本次 fetch 固定的 U | `6a9dcadb33d915fbedf80720a844968a6a8bea62` |
| 前次观察 U          | `66416dfa1dfa2da480b0bf3eadf3f26ad3188650` |

2026-11-08 20:08（Asia/Shanghai）fetch 成功。B 的全部历史可从 L 到达，缺失为 0；B 是 L 与 U 的共同祖先。U 比 B 多 7 个主线节点、9 个历史提交，本批全部保留待处理，未评估或合入。后续上游新增内容另开范围。本地 `main` 较旧，未用作比较基线，`origin/main` 的本地引用仍为 B。

## 文件与口径

| 文件                                                             | 内容                                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [scope.json](scope.json)                                         | 引用、fetch 结果、可达关系、数量、需求文档 blob、环境、原工作区指纹和扫描边界                                                                      |
| [candidates.jsonl](candidates.jsonl)                             | B→L 的全部 1,117 个净差异路径：649 修改、468 新增，含 603 个既有 `src` 修改；无删除或改名。记录两侧 blob、行数、候选标签、领域、需求指针及来源提交 |
| [history.json](history.json)                                     | L 独有的 46 个历史提交、26 个第一父链 merge、15 处非空 remerge 差异、7 个历史独有路径，以及 B→U 的未合入节点与路径变化                             |
| [direct-import-candidates.jsonl](direct-import-candidates.jsonl) | 固定 L 的 2,426 个代码文件中，指向净差异文件的 4,541 条直接引用候选；其中 471 个引用者路径本身没有净差异                                           |

候选标签按路径启发式生成，允许多标签；`unknown`、`possibleBridges`、`requirementCandidates` 都是审查线索。`possibleBridges` 只筛选既有非测试 `src` 文件，不证明它是薄桥接；新增代码也不自动视为独立职责。一个翻译或展示候选仍可能包含业务差异。所有候选的 `reviewStatus` 均为 `unreviewed`，没有默认批准的行为处置或验证成绩。

源码来源从 `git rev-list L --not B` 的普通提交及 merge 的 remerge 差异收集；全部净差异路径都有来源。历史独有路径包括被撤回、被上游追平或仅在冲突解决出现的路径，需在 P2 追溯其行为去向。26 个第一父链 merge 中有一项是本项目分支同步，不能全部当作 canonical 上游合入。

直接引用扫描处理静态 import/export-from、字符串字面量 import()/require()，解析 `@/`、相对路径及工作区 `@openstory/stitch`。它是词法候选，可能包含类型、Mock 或注释；未覆盖非字面量路径、`#` 条件导入、运行时注册、全部传递影响或语义调用关系。这些继续属于 P2，不能用扫描数量冒充调用链验收。

需求来源绑定执行起点的 Git blob。现行需求、已实现状态、未实施商业规划及已取消事项仍以来源文档为准，指针不表示该路径中的每处差异均已获需求认可。

结构范围已纳入 schema、migration、journal/snapshot 和生成类型。B→L 在该组只有 `src/platform/server/db/schema/generated-assets.ts` 与 `worker-configuration.d.ts` 两个修改路径；历史迁移等其余路径净差异为 0。P0 仅记录，不生成迁移或进行数据库操作。

## 工作区与证据

开始时索引为空，无未完成 merge/cherry-pick/revert。以下两个原有改动均独立备份并记录 SHA-256，排除本批提交：`vite.config.ts` 和未跟踪的 `docs/secondary-development/windows-dev-startup-20261108.md`。本地忽略目录 `.tmp/upstream-preservation-p0-p1-20261108/` 保存原文件字节、index、工作区 patch、生成脚本、完整 remerge 差异及验证日志；原始备份不提交，不能保证其他检出拥有它们。

可携带的 Git 来源、候选清单及结论保存于本目录和实施记录。可直接用固定 SHA 复核：

```powershell
git diff --name-status --find-renames <B> <L>
git diff --numstat <B> <L>
git rev-list <B> --not <L>
git rev-list --reverse --topo-order <L> --not <B>
git rev-list --merges --first-parent --reverse <initialFork>..<L>
git show --remerge-diff --format= <mergeSHA>
git log --first-parent --reverse --format="%H %s" <B>..<U>
git rev-list --count <B>..<U>
```

`initialFork`、每项来源 SHA、remerge 路径和差异 SHA-256 均见 JSON。remerge 的字节数和指纹对应上述命令 UTF-8 文本经 `trimEnd()` 后的本地保存内容，规范化方式亦在 `resolution.representation` 记录；不是包含末尾换行的原始 stdout 指纹。引用候选可从记录的 `from`、`line`、`specifier` 在固定 L 复核。各 JSONL 每个非空行是一条 JSON 对象，范围和来源是 P0 交付；逐业务块处置、原断言追踪、传递契约及全范围验证仍待 P2。
