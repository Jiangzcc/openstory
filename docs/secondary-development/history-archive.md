# 历史材料索引

<a id="records"></a>

现行规则和功能契约从 [README](README.md) 进入。本页只负责取回历史原件；历史报告中的计划、分支、测试和“待完成”状态属于各自时点，不覆盖当前决定。

## 固定 Git 原件

| 固定提交                                   | 保存内容                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `c572b906d3dc3ff33ea99d58fd64523c41b82710` | 2026-11-15 首轮归档前的 `preservation/`、`refactoring/` 等过程材料，362 个归档过程文件的来源         |
| `c92b2f5cb1739dc7585779b83a6177b1534e0f7d` | 2026-11-16 本轮整理前全部 51 份二开文档，包括旧需求/规格、国际化报告、上游评估、P0–P3 与隔离重构记录 |

其他文档的历史链接指向本页，链接标题保留 `提交:原仓库路径#片段`。按标题取回对应版本，不能把今天的现行说明当作历史运行报告。

```bash
# 查看本次归档的一份报告
git show 'c92b2f5cb1739dc7585779b83a6177b1534e0f7d:docs/secondary-development/fork-isolation-node26-followup-20261115.md'

# 枚举该版本的全部二开文档
git ls-tree -r --name-only c92b2f5cb1739dc7585779b83a6177b1534e0f7d -- docs/secondary-development

# 查看首轮归档的原始验证材料
git show 'c572b906d3dc3ff33ea99d58fd64523c41b82710:docs/secondary-development/preservation/20261115-p3-completion/verification.json'
```

## 已收敛的主题

| 历史文档组                                                                                          | 当前入口                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `requirements.md`、`mvp-specification.md` 及旧规则确认                                              | [需求与规则](confirmation.md)；A 编号仍在 [验收清单](acceptance.md)                                                     |
| `upstream-merge-assessment-*`、`upstream-merge-implementation-*`                                    | [上游维护状态](upstream-maintenance.md)；逐提交评估和当轮成绩取回原件                                                   |
| `upstream-preservation-p*`、`upstream-preservation-plan.md`、`p3-*`                                 | [上游维护状态](upstream-maintenance.md)；P3 未完成、暂缓项与 P4 未实施仍保留                                            |
| `fork-isolation-*`                                                                                  | [上游维护状态](upstream-maintenance.md)；历次退出证明、退役和未采用试点取回原件                                         |
| `i18n-development-plan.md`、`localization-*` 旧报告、`login-zh-preview.md`、`style-localization.md` | [界面国际化](localization-plan.md) 与 [系统指令](system-prompt-localization.md)                                         |
| 助手单项修复、作品卡片国际化、图片渠道审查及对抗性审查                                              | [界面国际化](localization-plan.md)、[文本渠道](text-channels.md)、[图片渠道](image-channels.md)；历史原因与验证取回原件 |
| `windows-dev-startup-20261108.md`                                                                   | 单次 Windows 启动诊断取回原件，不列为新的开发任务                                                                       |

## 本机验证证据归档

2026-11-16 的本地归档位于 `D:\code\github\openstory-local-archives\20261116-cleanup`，不属于仓库文件，也不会随 Git 推送。

- `docs-before-cleanup.zip`：从固定 `c92b2f5cb` 导出的全部 51 份二开文档。
- `tmp-evidence.zip`：原 `.tmp` 中的验证报告、日志、截图、样例与试验材料；配套 `manifest.json`、`archive-summary.json` 记录收录路径、指纹及校验。
- 初始快照的 302 个顶层项搬到该目录的 `pending-deletion/`；旧依赖备份分两目录保留。递归删除被自动审批拒绝，采用可逆搬移，未据此释放原件所占空间。
- 目录链接不作为验证原件归档；不得沿链接删除当前依赖或其他工作树。

压缩包以 `tmp/` 为前缀：原 `.tmp/breadcrumb-browser-20261116/` 对应包内 `tmp/breadcrumb-browser-20261116/`。清理期间新出现的 `dev-startup-windows-20261116.log` 保留在 `.tmp`，不混入初始快照。真实探测结果和人工截图并非全部可再生，不能以重跑结果代替原件；需要在其他电脑使用时须另行携带本地归档。

本次减少的是当前树的材料和重复说明，不代表生产功能变化或未来合并冲突下降。
