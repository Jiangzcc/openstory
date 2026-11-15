# 历史审查材料

<a id="records"></a>

历史差异表、逐路径台账、运行日志和截图已从当前工作树归档。完整原件保存在提交 `c572b906d3dc3ff33ea99d58fd64523c41b82710`；当前规则和需求仍从本目录 [README](README.md) 查阅。

旧文档中的归档链接指向本页，链接标题保留原件的仓库路径及片段。查看指定原件：

```bash
git show 'c572b906d3dc3ff33ea99d58fd64523c41b82710:docs/secondary-development/preservation/20261115-p3-completion/verification.json'
```

完整导出两组材料到本地临时文件：

```bash
git -c core.autocrlf=false archive --format=zip --output=.tmp/secondary-development-history.zip c572b906d3dc3ff33ea99d58fd64523c41b82710 -- docs/secondary-development/preservation docs/secondary-development/refactoring
```

原始运行和人工评审并非全部可再生，应取回历史原件，不能用重跑结果改写过去的验证结论。该提交尚未推送时，原件通过本地 Git 查阅。

本次归档减少当前工作树中的过程材料，不代表生产代码隔离或未来合并冲突已经改善。
