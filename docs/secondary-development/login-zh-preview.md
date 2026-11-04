# 登录页 i18n 样例

日期：2026-11-03。状态：登录页及必要国际化基础已实现并完成下列验证；全站迁移、账号邮件和完整阶段验收继续按计划推进。

用户授权先修改一个页面查看中文效果，并明确要求直接用英文原文作为翻译键。本次选择现有 /login，沿用上游布局和认证流程。二开分支为 develop，对照的上游基线为 1999cb15816bd9f3317b5d7ae2121685ef338663。

## 1. 上游行为与二开动机

上游登录页与共享 AuthForm 使用硬编码英文，根文档写死 lang=en。上游已有 Cookie 读写、Select、认证接口、登录状态及重定向，本次直接复用。

二开实现独立中英文语言包和 i18next/react-i18next 接入，使登录页默认中文、可即时切换英文并保存当前浏览器选择。先验证这一条完整路径，不将单页授权扩展为全站或商业功能实施。

## 2. 文案约定

按用户要求使用英文原文作为翻译键，命名空间用于划分职责：

```tsx
const { t } = useTranslation('auth');

<CardTitle>{t('Welcome')}</CardTitle>
<CardDescription>{t('Sign in or create an account')}</CardDescription>
```

中文 auth.json 的对应条目：

```json
{
  "Welcome": "欢迎使用 OpenStory",
  "Sign in or create an account": "登录或创建账号"
}
```

英文目录中的键和值均保留英文原文。配置 keySeparator=false、nsSeparator=false，句点、冒号及邮箱中的标点不参与拆键。上游原文变化时，同步更新调用及两种语言包。

普通文案通过 useTranslation 渲染；带条款链接、隐私链接、举报入口或 code 元素的整句通过 Trans 和受控 React 组件渲染，不拼接译文或注入任意 HTML。中文法律链接保持整段换行，避免在词中断开。

## 3. 实际改动范围

| 位置                                                                                                                                                     | 本次职责                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [locale.ts](../../src/platform/i18n/locale.ts)、[preference.ts](../../src/platform/i18n/preference.ts)                                                   | 支持语言、默认值及 Cookie 名；通过既有 readCookie 解析请求/浏览器语言；非法编码回到中文，无关异常继续抛出 |
| [runtime.ts](../../src/platform/i18n/runtime.ts)、[resources.ts](../../src/platform/i18n/resources.ts)、[类型声明](../../src/platform/i18n/i18next.d.ts) | 创建独立实例、组装样例资源及检查翻译键                                                                    |
| [语言包](../../src/platform/i18n/locales/)                                                                                                               | en 和 zh-CN 下的 auth/common JSON 资源；英文原文为键                                                      |
| [use-locale.ts](../../src/ui/i18n/use-locale.ts)、[use-page-title.ts](../../src/ui/i18n/use-page-title.ts)                                               | 即时切换、复用 writeCookie 保存并检查结果、反馈保存失败；同步浏览器页面标题                               |
| [language-switcher.tsx](../../src/ui/i18n/language-switcher.tsx)                                                                                         | 复用现有 Select 提供中英选择，保留原有主题和组件风格                                                      |
| [router.tsx](../../src/router.tsx)                                                                                                                       | 每次 router 工厂调用创建一个实例，以 I18nextProvider 包装，SSR 只传递 locale 字符串                       |
| [根路由](../../src/routes/__root.tsx)                                                                                                                    | 在原有重定向之后读取语言，渲染对应 html lang；保留现有 Provider、查询和实时连接                           |
| [登录页](../../src/routes/_auth/login.tsx)                                                                                                               | 接入语言控件、原文翻译调用、SSR 标题和浏览器标题                                                          |
| [共享登录表单](../../src/platform/ui/auth/auth-form.tsx)                                                                                                 | 将已有静态文案和兜底提示接入翻译；错误兜底保存英文键，以显示时的语言渲染                                  |
| [运行时测试](../../src/platform/i18n/runtime.test.ts)、[语言偏好测试](../../src/platform/i18n/preference.test.ts)                                        | 默认值、非法 Cookie、实例隔离、英文原文键约定、标点、资源键与富文本标记一致性                             |
| [客户端边界测试](../../src/platform/client-server-boundary.test.ts)                                                                                      | 将脚本图的解析范围限定为脚本文件，静态 JSON 作为叶子；加入相应回归检查                                    |
| package.json、bun.lock                                                                                                                                   | 固定新增 i18next 26.7.1、react-i18next 17.1.11；冻结安装检查通过                                          |

单页授权所需的共享组件影响：AuthForm 也被既有登录弹窗复用，其表单文案会随当前语言更新；弹窗壳层、验证码页和其他路由没有在本次逐页翻译。

原 copy 文案参数及 auth-form-copy.tsx 临时模块已移除。既有 AuthForm 超长函数仅做必要文案接入，不借本次任务拆分无关认证逻辑。新增模块均按项目风格组织，没有放宽领域、服务端或数据库边界。

锁文件额外收敛了两个既有 workspace 元数据差异：删除重复的 @durable-streams/server-cloudflare 项，补入 package.json 已有的 @tanstack/ai-client 声明。未升级已有依赖；本地包仓库造成的无关地址批量变更已剔除。

## 4. 首屏与语言切换

- 合法偏好为 zh-CN / en；缺失、非法或不支持的值均使用 zh-CN。浏览器英文偏好不会覆盖中文默认值。
- 使用既有 Cookie 接口保存 openstory_locale，沿用其有效期、Path=/ 与 SameSite=Lax 配置，不引入数据库字段或第二套持久化协议。
- 实例在 getRouter 内创建，通过 Provider 显式传递；服务端请求间不共享可变语言实例。样例的两种语言资源随构建提供，首屏无需额外下载目录。
- 根 beforeLoad 读取请求语言；SSR 的 dehydrate/hydrate 只传递语言字符串，i18next 实例留在各自运行时，不放进可序列化 loader 数据。
- 切换调用 changeLanguage，不导航、不重建 router 或登录表单；邮箱状态继续保留。文案、标题与 html lang 一起更新。
- Cookie 写入失败或写后读回不一致时，语言控件显示保存失败说明。此失败反馈已实现，真实浏览器禁用 Cookie 的分支尚未单独验收。

## 5. 最终验证记录

| 检查                           | 结果与证据                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 相关文件格式及 type-aware lint | 通过，使用项目 oxfmt / oxlint                                                                                                   |
| 全项目 bun typecheck           | 通过                                                                                                                            |
| 国际化针对性测试               | 18 项通过，含英文原文键、标点、资源一致性、默认值和请求实例隔离                                                                 |
| 锁文件                         | bun install --frozen-lockfile --ignore-scripts 通过，没有更改依赖                                                               |
| 生产构建                       | bun run build 通过，继续使用原有压缩和 Latin-1 服务端转换                                                                       |
| 实际 Workerd SSR               | 5 种请求均为 200：默认值（Accept-Language 为英文）、显式中英文、非法值及非法编码；HTML lang、标题及文案正确                     |
| 并发 SSR                       | 8 个交替语言请求全部返回各自语言                                                                                                |
| 浏览器切换                     | 中英即时更新，标题与 html lang 同步；测试邮箱在双向切换后保持，截图可见；刷新分别保持中/英文                                    |
| 桌面/窄屏                      | 1280×720 与 390×844 检查通过，中英文没有横向溢出，关键按钮和现有链接可见；所测浏览器日志无 warning/error 或水合错误             |
| 边界测试                       | 当前 14 项通过、2 项失败；其中新增的静态资源分界检查通过。未改动上游基线为 13 项通过、相同 2 项失败，规范化基线路径后的诊断一致 |

边界测试失败源于既有测试以 / 判断路径和组成根，Windows 路径导致误判。本次仅修正与 JSON 语言包直接相关的脚本图解析，不修改无关 Windows 路径规则。合并后的针对性测试结果为 32 项通过、上述 2 项既有失败；不能表述为全部测试通过。

本地预览为 http://localhost:3000/login，已在应用浏览器保留。当前使用已有构建预览服务，未重新执行数据库迁移或完整 dev 启动脚本。

最终本地证据存放在忽略目录 .tmp/login-zh-preview：

- i18n-desktop-zh.jpg / i18n-desktop-en.jpg：最终桌面截图。
- i18n-mobile-zh.jpg / i18n-mobile-en.jpg：最终窄屏截图。
- i18n-build.log：生产构建结果。
- i18n-ssr-results.json / i18n-browser-results.json：实际 SSR、并发及浏览器检查。
- i18n-final-test-results.json / i18n-final-tests.log：最终针对性及边界测试。
- upstream-boundary-results.json / i18n-boundary-comparison.json：未修改基线及失败诊断对照。

DOM 检查会遮蔽邮箱值，输入保留依据实际截图核对。浏览器只填写测试地址 preview@example.invalid，没有提交登录。真实验证码、Google 授权、邮件投递、付费模型调用、数据迁移、部署和 Git 提交/推送均未执行。

## 6. 后续范围与升级关注点

- 全站页面、验证码流程、全局导航与账号相关邮件仍按第一阶段计划实施；本次不代表 L01–L09 或 IT01–IT11 全部完成。
- 服务端原始错误消息保持原文，本次翻译表单既有兜底消息；完整错误国际化仍待后续处理。
- 资源提取工具、Storybook 完整回归、全站格式化及 Workerd 堆增量验收仍待后续批次，不以单页构建代替完整环境验收。
- 上游更新 router/根路由时，复核 Wrap、查询集成、SSR dehydrate/hydrate 与原有重定向；本次沿用这些公开接口，没有另建认证或业务流程。
- 上游更新 AuthForm、英文措辞或条款结构时，同步英文原文键和两种语言资源，复核富文本标记、选项门控、错误兜底及双向布局。
- 上游更新依赖或边界测试时，复核锁文件、React/i18next peerDependencies 与静态资源脚本图的解析契约。

完整方案见 [i18n 开发计划](i18n-development-plan.md)，产品范围和验收见 [中文阶段计划](localization-plan.md)。
