# BH 零件组合匹配演示

用于 GitHub Pages 的纯静态中文网页，无运行时第三方依赖、无后端。

## 当前功能

- 粘贴 Excel 两列（零件号、数量），或使用逗号、顿号、空格分隔的零件号序列。
- 未写数量时明确按 1 计算，支持正整数数量。同一零件重复出现时合并数量。
- 忽略顺序，完整比对零件号和数量。子集、超集、数量变化均不算匹配。
- 查询已有 BH，未匹配时确认新增；同一组合复用一个 BH。
- 在当前浏览器保存新增组合；刷新保留，同源多标签页通过 Web Locks 串行写入。
- 搜索组合库、载入示例、复制 BH、导出完整组合明细 CSV、重置本地新增。
- 支持手机布局、键盘操作与减少动态效果设置。

**新增记录只属于当前浏览器，不会提交到 GitHub，不会同步给其他人。清除站点数据或使用隐私浏览可能丢失记录。**

## 示例来源

`bh-demo/dist/data/sample.json` 来自用户授权公开演示的脱敏 `AAA.xlsx / Sheet1`。
F 列合并单元格对应 BH，G 列是其包含的零件号，导入时向下展开 BH。
A 列提供 18 个零件主数据，C 列提供 7 个 BH。示例的数量经用户确认均为 1。
共 7 个 BH、26 条归属关系、14 个被组合引用的不同零件，无重复完整组合。
原始 Excel 不提交到仓库，不发布到 Pages。

例如 `BZ1100001 ×1 + BZ1300006 ×1 + BZ1300011 ×1` 对应 `BH1720001`。
单独输入 `BZ1200003` 是有效的新组合，可用于演示新增。

## 本地运行

需要 Node.js 22 或更新版本，无需 npm install。

```powershell
npm test
npm start
```

访问终端显示的 `http://127.0.0.1:4173`。不要直接双击 HTML，数据由相对路径 fetch 读取。
本地预览服务只监听本机，只提供 `bh-demo/dist` 文件，不会暴露工作目录里的 Excel。

## 发布到 GitHub Pages

优先在已经完成 `gh auth login` 的普通 PowerShell 终端运行：

```powershell
cd C:\Users\Xena\PyProject\shanqi_SQL
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\publish-github.ps1
```

脚本会检查登录账号、运行测试、创建公开的 `bh-match-demo` 仓库、仅提交指定项目文件、启用 Pages、等待部署并核对公开页面及示例数据。它不会读取、打印或保存访问令牌，不修改全局 Git 凭据配置，不强制推送，也不上传原始 Excel。
此命令使用 Windows 自带的 Windows PowerShell，无需安装 PowerShell 7。`-ExecutionPolicy RemoteSigned` 仅作用于此次启动的进程，允许运行本地创建的脚本，不永久修改系统策略。该命令已使用 `-Plan` 在 Windows PowerShell 中验证通过。
若同名仓库已有不相关内容，会停止，允许用 `-RepoName bh-match-demo-2` 指定新名字。可加 `-Plan` 只查看计划，不修改本地或远端。
默认账号为当前任务的 `yxena9276`，不匹配时停止。

手动发布步骤：

1. 创建一个公开仓库，例如 `bh-match-demo`。仓库和网页仅包含脱敏数据。
2. 把本项目提交到该仓库的 `main` 分支（包括隐藏的 `.github` 目录）。
3. 在仓库 Settings → Pages → Build and deployment，将 Source 设为 **GitHub Actions**。
4. 在 Actions 中运行 “Test and deploy demo to GitHub Pages”，或推送一次提交。
5. 工作流先运行测试，成功后只发布 `bh-demo/dist`，网址见工作流的 deployment 输出。

已配置项目路径下的相对资源地址，适用于 `https://<用户名>.github.io/<仓库名>/`。
如果工作流最初在启用 Pages 之前运行失败，启用后重新运行即可。

GitHub CLI 已登录并有权限时，也可以从此目录创建仓库：

```powershell
git init -b main
git add .
git commit -m "Add BH matching demo"
gh repo create bh-match-demo --public --source . --remote origin --push
```

此后仍需在仓库设置启用 GitHub Actions 作为 Pages 发布源。切勿在网页中放数据库密码或 GitHub 令牌。

## 保存与正确性边界

- 浏览器演示使用排序、合并后的结构化完整清单作为匹配键，直接比对内容，不依赖哈希碰撞概率。
- 数量使用安全范围内的整数，单种零件数量上限 10 亿；每次输入最多 2,000 项。
- 零件号大小写敏感，保留前导零；未知零件不允许自动加入主数据。
- 本地新增必须在 HTTPS 或 localhost 的安全上下文中使用 Web Locks；不支持的浏览器仍可查示例，但禁用新增。
- 每次新增在锁内重读存储、校验、查重、分配编号和写入。同一浏览器同源标签页可以协调。
- 外部脚本、手动修改存储、浏览器崩溃或多个设备之间的写入，不在这套本地并发机制的保证范围内。
- 读取到损坏数据时显示错误并阻止新增，不静默覆盖。浏览器存储配额错误不会被报告为成功。
- 数据库版应使用后端、事务、唯一约束和数据库序列；当前本地递增编号方案不可直接用于服务端并发。

## 后续升级到多人共享

保留网页输入及结果交互，将读取数据、查询和新增替换为服务端 API。
使用 PostgreSQL 保存零件、组合和明细。规范化规则固定版本后计算组合指纹，按索引定位并核对完整清单。
唯一约束和事务防止重复创建，数据库序列分配 BH。查询不存在并创建的路径访问主库。
真实数据迁移先进入暂存表，检查重复组合、数量、归属及编号后再发布。
新增登录权限、创建审计、备份及恢复验证。数据量增加时按实际查询量和执行计划压测扩容。

## 文件布局

```text
.github/workflows/pages.yml  测试和 Pages 发布
bh-demo/dist/               实际发布的静态网页
bh-demo/dist/data/           脱敏种子数据
bh-demo/tests/              匹配、持久化及并发逻辑测试
bh-demo/scripts/serve.mjs    仅本机的预览服务
```
