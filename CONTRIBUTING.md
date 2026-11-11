# 参与贡献

感谢你愿意改进这个插件。这个项目是「一个人给自己写工具」长出来的，所以在流程上比常见开源项目松一些，但有几条底线希望你和我们一起守住。

## 先提 issue，再写代码

改动涉及工具入参、配置键、返回结构、面板布局时，请先开一个 issue 说明场景和设计。避免你写了几百行，最后因为方向不同没法合进来。

小修（错别字、日志措辞、单点 bug）可以直接提 PR。

## 分支与提交

- 从 `main` 切分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
- 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：`fix(session): 会话过期后自动重登`。
- 一个 PR 只做一件事；重构和功能分开提。

## 代码风格

- ESM、`node:` 前缀内置模块、两空格缩进、单引号、尾随逗号。
- 不引入第三方运行时依赖。这个插件的卖点之一是「零依赖」，只用 `fetch` / `FormData` / `node:crypto` / `node:fs`。
- 注释写「为什么」，不写「是什么」。特别是学校接口那些反直觉的行为（比如只有「回放」状态才有转录、雷达点名 500 米半径、服务端在失败响应里才回 `distance`），值得留一行说明。
- 不写防御性冗余代码。参数先校验一次，之后信它。

## 不要提交真实数据

这是硬性要求，PR 因为这条被打回是最常见的：

- 学号、姓名、密码、Cookie、`auth_key`、任何 token；
- 真实的课程名、教师名、教室、`sub_id` / `course_id` / `activity_id`；
- 本机绝对路径（`C:\Users\<你的名字>\...`、`D:/某个私人目录`）；
- `preview/` 下的截图必须是 `--demo` 生成的示例数据；
- 真实抓下来的课件、笔记、成绩。

测试要用真实网络时，写一个 `*-live.mjs` 脚本单独跑，不要放进默认测试集，也不要把输出存进仓库。假数据统一用 `test/fixture.env` 里的 `3200100001` / `p@ss=word`。

## 测试

改完先跑一遍离线测试，全部通过再提 PR：

```bash
for t in smoke plugin client panel-mock rollcall-locations rollcall-answer \
         rollcall-switch rollcall-tools notes ppt engineering-parser \
         independent-panel requirements-v12; do
  node test/$t.mjs || echo "FAIL $t"
done
```

`smoke` / `route` 会真的访问学校站点。校外网络下 `qsxy` 会返回「仅校内 IP 可访问」，测试里会打印 `SKIP` 而不是失败，属于预期。

## 关于 AI 辅助

可以用 AI 写代码，但请自己读一遍再提交。我们不收下面这类东西：

- 满屏 `try/catch` 包裹和「如果出错就返回空对象」式的自我安慰；
- 为了一个字符串拼接引入一个库；
- 在没验证过接口的情况下臆造字段名和错误码。

## 报告问题

提 issue 时请带上：插件版本（`package.json` 的 `version`）、DSH 版本、复现步骤、以及**脱敏后**的报错。贴日志前先确认里面没有学号和 Cookie。

## 许可证

本项目以 GPL-3.0-only 发布。提交 PR 即表示你同意以同一许可证分发你的贡献。
