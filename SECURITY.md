# 安全策略与漏洞反馈 (Security Policy)

本项目高度重视软件安全性与交大师生隐私保护。如果您在《SJTU 课程下载器》（sjtu-course-downloader）中发现安全漏洞或隐私风险，感谢您协助我们以负责任的方式进行披露与修复。

---

## 支持的版本 (Supported Versions)

我们仅针对最新稳定主版本提供安全更新与漏洞修复：

| 版本系列 (Version) | 支持状态 (Supported) | 说明 |
| :--- | :---: | :--- |
| `2.5.x` |  支持 (Active) | 当前最新稳定版本 |
| `< 2.5.0` | ❌ 不再支持 (End of Life) | 请尽快升级至最新版 |

---

## 报告安全漏洞 (Reporting a Vulnerability)

为了保护用户的数据安全与登录凭据不被滥用，**请勿在公开的 GitHub Issue 或 Discussions 中公开发布未修复的安全漏洞详情**。

### 推荐报告渠道 (Preferred Method)

请优先使用 GitHub 官方提供的 **私密漏洞报告 (Private Vulnerability Reporting)** 通道提交：

1. 访问项目的 [Security Advisories 报告入口](https://github.com/sunalan2025/sjtu-downloader-all-in-one/security/advisories/new)；
2. 填写漏洞描述、复现步骤（PoC）、潜在影响范围及修复建议；
3. 提交后，维护团队将收到加密私密通知并直接在私密讨论区与您沟通。

### 备用反馈渠道 (Alternative Contact)

若无法通过上述链接提交，可通过 GitHub 创建私密 Issue 或联系项目维护者进行点对点沟通。

---

## 漏洞响应与修复流程 (Response & Remediation)

1. **初步确认**：我们将在 **48 小时内** 确认并评估漏洞报告的有效性与严重级别；
2. **安全修复**：一旦确认存在安全隐患，我们会在私有分支中加急开发补丁并编写自动化回归单测；
3. **版本发布与公开致谢**：修复完成后，我们将发布新版发布包，并在安全公告中为您公开署名致谢（若您同意）。
