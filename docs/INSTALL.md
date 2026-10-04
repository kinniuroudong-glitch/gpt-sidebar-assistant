# 安装手册

GPT 随页助手当前通过 GitHub 以“加载已解压扩展”的方式安装。仓库中的 `extension/` 已经是可运行版本，无需编译，也不需要 OpenAI API Key。

## 安装前准备

- 当前稳定版 Google Chrome（清单最低版本为 Chrome 116）
- 已能正常登录的 [ChatGPT 网页账号](https://chatgpt.com/)
- 可正常访问你要分析的网站；视频字幕功能还需要访问 DownSub 和 YouTube

项目主要在 macOS + Chrome 上验证。Windows、Linux 和 ChromeOS 在架构上兼容，但尚未实机测试。Safari 原生扩展不受支持。

## 从 GitHub 安装

1. 打开仓库：<https://github.com/kinniuroudong-glitch/gpt-sidebar-assistant>。
2. 点击绿色 **Code** 按钮，再点击 **Download ZIP**。
3. 解压 ZIP。请保留整个目录结构，不要只复制单个 JavaScript 文件。
4. 在 Chrome 地址栏输入 `chrome://extensions`。
5. 打开页面右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择刚解压目录中的 **`extension/`** 文件夹。正确目录内应直接看到 `manifest.json`。
8. 打开任意普通网页，刷新一次，然后点击 Chrome 工具栏中的扩展图标。

若图标不在工具栏，可在“扩展程序”菜单中固定“GPT 随页助手”。首次使用前，请在普通标签页登录 ChatGPT。

## 更新

1. 下载并解压新的仓库 ZIP，可覆盖旧副本或放到新目录。
2. 回到 `chrome://extensions`，在“GPT 随页助手”卡片上点击刷新图标。
3. 刷新来源网页，并关闭后重新打开侧栏。

Chrome 不会自动更新这种本地加载的版本。更新后可在扩展卡片或 `extension/manifest.json` 中确认版本号。

## 网站访问权限

扩展声明 `http://*/*` 与 `https://*/*`，因为“加入当前页”和“总结当前页”需要在你选择的不同网站上提取正文。读取操作由侧栏按钮触发；扩展不会在普通浏览时自动把每个页面发送给 ChatGPT。

如果 Chrome 将网站访问权限设为“点击扩展程序时”或仅允许部分网站，正文或字幕提取可能失败。请在扩展详情页允许当前网站；YouTube 字幕功能还应允许：

- `youtube.com`
- `downsub.com`
- `subtitle.downsub.com`
- `chatgpt.com`

## 卸载

打开 `chrome://extensions`，在“GPT 随页助手”卡片上点击“移除”。如需同时删除未打包的源文件，再手动删除之前解压的仓库目录。

卸载会移除 Chrome 为扩展保存的本地设置。由 ChatGPT 管理的聊天数据遵循你的 ChatGPT 账号与临时聊天规则；请参阅 [隐私说明](PRIVACY.md)。
