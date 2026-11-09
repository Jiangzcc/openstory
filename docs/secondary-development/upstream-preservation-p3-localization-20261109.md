# P3 第四批：翻译维护差异报告

日期：2026-11-09。固定起点：develop 的 2c7853d88ccad1219217c2d2a43d5b154f69c851。本批为本地开发工具；当前结果及源码指纹见 [验证记录](preservation/20261109-p3-localization/verification.json)。

## 原有行为与目标

上游持续改变组件文案和英文系统模板。二开已有英文原文键、中英文语言资源、帮助 Markdown 翻译及按 promptLocale 选择的系统指令；既有 resources、markdown 和 prompt catalog 测试检查资源与模板结构。此前没有按两个版本或当前工作树生成统一翻译复核清单的入口。

本批新增版本差异报告，让维护者看到本轮新增/删除文案、语言资源修改及可能需要同步的系统模板。报告仅提出人工复核候选，不能批准翻译含义。原有完整性测试继续复用。

## 使用方式

在仓库根目录执行：

```bash
# HEAD 对当前工作树，包括暂存、未暂存和未忽略的未跟踪文件
bun scripts/check-localization-changes.ts --base HEAD --out .tmp/localization-review.json

# 两个已存在的提交或引用
bun scripts/check-localization-changes.ts --base HEAD~1 --head HEAD --out .tmp/localization-review.json
```

不传 --out 时仅向标准输出打印 JSON；传入时写指定报告文件。Git 引用先解析成固定提交 SHA，Git 命令用参数数组执行；中文、空格文件名使用 NUL 分隔。报告输出不得覆盖比较两侧的 src/docs 输入路径，包括当前已删除的路径；现存路径及父目录通过系统原生真实路径解析，Windows 同时归一大小写，避免 8.3 短路径与完整路径指向同一文件却判断不等。

工作树内容为执行时延迟读取，扫描期间应避免并发编辑；它不提供事务式快照。提交间比较使用固定提交的内容，不读取工作树改动。

## 输出与人工复核

| 字段                | 用途与边界                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| uiCopy              | AST 采集 t()/对象 t() 的静态原文键、Trans i18nKey、JSX 文本及常见展示属性，按前后差异给出增删及行号；重复项保留次数 |
| dynamicKeys         | 位于 uiCopy 条目内；动态 key 单列人工检查，不当作静态缺译结论                                                       |
| namespaceHints      | 文件级 Hook 上下文；只有调用或 Trans 中显式的 ns 才归属到具体 key，不猜多个 Hook 的作用域                           |
| resources           | 平铺 en/zh-CN JSON 的键和值增删改，保留标点及插值；不替换英文原文键                                                 |
| systemPrompts       | 已登记主模板与领域资源的整模块 AST 指纹及配对状态；英文所有者改变时提示对应资源复核                                 |
| helpMarkdown        | 当前帮助内容目录中的 Markdown 改动路径，复用原 markdown.test.ts 检查                                                |
| unclassifiedUiFiles | 源码 AST 改变但没有识别出文案变化的 UI 文件，供人工补查                                                             |
| sources             | 被比较文本的 SHA-256 原始内容指纹，定位本次输入                                                                     |
| existingChecks      | 已有资源、帮助和模板检查的命令；executedByReport=false，报告工具不自动运行这些测试                                  |

每份报告固定 status=report-only。systemPrompts 始终 needs_review、semanticApproval=false；中文资源同时改变也不能自动通过。sourceKind 表示 english-owner、localized-counterpart、bilingual-owner 或 unmapped-candidate 的模块职责，不把配对模块当成单一语种。同文件双语改动不推断变动语种。

UI 扫描覆盖 src 下 TSX 及根级/领域 ui 目录中的 TS，排除测试、故事、夹具、src/test、.gen/.generated 文件。普通 JS 字符串表、别名翻译函数、跨文件常量和运行时内容需要人工检查；展示属性和文件名识别属于启发式。系统模板按显式清单及 prompt 命名候选发现，整模块指纹变化可能只是逻辑改变；新增所有者或间接依赖仍需分类。二进制依靠文本扩展名白名单排除，不作内容类型检测。

指纹忽略注释、格式、raw 表示和 CRLF，保留 AST 结构；局部 guidance 常量改变同样触发。主英文注册表对应 7 个中文资源/聚合模块，领域所有者继续留在原领域。报告不 import 或执行业务模板，不读取真实凭证或用户数据，不改语言包、promptLocale、消息角色、协议标记或业务运行时。

## 改动范围与结构收益

新增入口 scripts/check-localization-changes.ts；解析、Git 快照、UI 文案、资源比较、系统模板及报告组合分别归属 scripts/localization/。复用已有直接依赖 @tanstack/router-utils 的 Babel 解析入口，节点类型从同一公开接口的真实参数类型推导，没有直接引用传递依赖，也没有新增依赖或修改锁文件。

本批新增 10 个脚本/测试文件，应用核心接入点为 0；没有移动业务模块。它把翻译维护的版本差异入口集中到一处，已有结构检查保持原职责。P4 的 CI 接入尚未实施。

## 验证与失败修正

所有测试使用 bun run test（Vitest），最终验收按同一轮去重统计，不累加复跑。以下路径相对 .tmp/p3-localization-20261109/，原始本地报告与日志保留；可提交的摘要和最终源码/原测试指纹见验证记录。

| 运行                    | 实际结果                           | 说明                                                                                                 |
| ----------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| baseline.json           | 4 文件 / 47 项通过                 | 原 UI/运行时/任务语言回归                                                                            |
| baseline-prompts.json   | 5 文件 / 77 项通过                 | 原模板及真实模板至 Mock 请求回归；与上组不重叠                                                       |
| focused-1.json          | 3 文件 / 86 项通过                 | 初版新工具回归                                                                                       |
| integrated-1.json       | 12 文件 / 213 项通过               | 补强后的原有与新增测试合跑                                                                           |
| integrated-final.json   | 12 文件 / 220 项，219 通过、1 失败 | Windows 同一输入文件的输出保护未触发                                                                 |
| cli-path-fix.json       | 1 文件 / 11 项，8 通过、3 失败     | 普通 realpathSync 未在测试进程消除短路径；首个用例覆盖临时夹具，后两项因夹具已成报告 JSON 而解析失败 |
| cli-path-diagnostic.log | 1 失败、10 跳过                    | 单独保留失败用例，输出实际短路径/完整路径身份差异，随后删除临时诊断代码                              |
| cli-path-fix-2.json     | 1 文件 / 11 项通过                 | 使用 realpathSync.native，保留原大小写断言并新增现存/删除输入的绝对路径反例                          |
| integrated-final-2.json | 12 文件 / 222 项全部通过           | 原有 124 项 + 新增 98 项，源码指纹在运行前冻结                                                       |
| integrated-final-3.json | 12 文件 / 222 项全部通过           | 依赖类型修正后的最终整合，原 124 项 + 新增 98 项                                                     |

保护失败仅发生于隔离临时 Git 仓库，临时夹具安全清理；没有覆盖用户源码。修正为解析实际文件/最近存在父目录的真实路径，再按平台比较；没有删除原断言或绕过 Windows 场景。静态检查与最终集成结果单独记录，不能拿前一轮通过替代最终验收。

首次正常提交被 Knip 拦截：两处 @babel/types 类型导入引用了未直接声明的传递依赖。失败提交没有落地，原 hooks 保持启用。修正为从已有直接依赖的 generateFromAst 公开签名推导真实节点类型，界面扫描通过 Extract 获取具体节点；没有伪造类型或增加依赖。修正后重新执行整合回归及静态检查，再次正常提交，实际结果见验证记录。

独立审查发现根级 src/ui/*.ts 漏检及 .generated/src/test 误报，已按实际路径补规则并新增回归；Hook namespace 变化、新 prompts 目录候选、二进制跳过和 sourceKind 语义也有反例。原 9 个测试文件共 124 项保持字节不变，新增测试不替代其断言。

实际工作树 CLI 的 UI、语言资源、系统模板及帮助内容候选为 0，符合本批没有修改应用文案；这只能说明此批没有该类差异，不能证明全站没有漏译或中文语义正确。最终全仓 bun typecheck、本批 10 个源码/测试文件的 type-aware lint、全仓 bun dead-code、全部本批文件的格式与 diff 检查通过；正常提交 hooks 保持启用。最大源码文件 259 行，最大测试文件 504 行；执行函数最大 41 行，suite 注册容器最大 50 行。最终真实运行及静态检查结果见验证记录。

## P3 状态与后续边界

四批局部成果保留：任务上下文候选经验证保留现状，渠道 API 分类集中一处，单镜头复用已解析配置与报价，翻译维护新增差异报告。P3 整体尚未完成；后续按 [全量收敛设计](upstream-preservation-p3-global-design-20261109.md) 覆盖全部长期二开职责与差异，不能以试点成果或某次冲突清单收口。P4 及后续阶段未执行。

本批仅验证本地 Node/Vitest、临时 Git 仓库和现有 Mock 请求；没有真实供应商、Workerd 引擎、浏览器/E2E、生产构建、远程数据库、邮件或部署证据。CONTINUE-LLM-SOURCE 按用户决定继续暂缓；BYOK、币种和组织钱包未改动。

原有 src/routeTree.gen.ts 用户改动保持字节不变，不纳入本批提交。本批仅作正常 hooks 下的本地提交，未推送。
