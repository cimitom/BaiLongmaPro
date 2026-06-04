# AGENTS

## 修改记录

- 2026-06-03：补充 `.gitignore`，忽略本地配置、缓存、数据库、虚拟环境和临时产物，避免把运行态文件推到 GitHub。
- 2026-06-04：修复群聊总结发图回退文字的问题。原因是 `src/social/wechat-group-report-renderer.js` 只在 macOS 路径里找 Playwright Chromium，Windows 下默认可执行文件失效会导致海报渲染失败。已补充 Windows/macOS/Linux 的 Chromium/Edge/Playwright 缓存路径兜底，渲染脚本已验证可输出 PNG。
- 2026-06-04：修复微信群回复时 @ 人偶发不准确的问题。`src/social/wechaty-duty-group.js` 的 @ 显示名选择已改为当前群昵称/成员表 `room_alias` 优先于传入的旧昵称或联系人备注，并补充回归测试。
- 2026-06-04：按要求把当前仓库 Git 提交用户配置为 `yideng966 <yideng966@users.noreply.github.com>`，并准备重写历史提交的作者/提交者信息后推送 GitHub。

## 规则

- 后续每次涉及代码或配置修改时，先在这里补一条简短修改记录，再继续提交。
