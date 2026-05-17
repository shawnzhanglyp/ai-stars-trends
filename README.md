# GitHub AI Stars 增长榜

用于发现 GitHub 上 AI 相关项目，并按近 24 小时、近 7 天、近 30 天的 stars 增长排行。也可以切换到自定义项目列表，手动填写要跟踪的仓库。

## 运行方式

进入项目目录：

```bash
cd /data/github
```

启动本地静态服务：

```bash
python3 -m http.server 4173
```

然后在浏览器打开：

```text
http://127.0.0.1:4173/
```

停止服务时，在终端按 `Ctrl+C`。

## 使用说明

- 默认使用 `AI 发现` 来源。输入框中每一行是一个 GitHub 搜索条件，例如 `topic:llm stars:>50 archived:false fork:false`。
- 如果只想查固定仓库，把“来源”切到 `自定义项目`，每行填写一个仓库，例如 `openai/openai-python`。
- 点击“日”“周”“月”切换统计周期，分别对应近 24 小时、近 7 天、近 30 天。
- `候选数` 控制 AI 发现阶段最多精算多少个候选仓库。数值越大，覆盖越广，但请求越多、速度越慢。
- 点击“刷新”会重新从 GitHub API 拉取最新数据。
- `Token` 不是 GitHub 账号，也不是密码；它是 GitHub 生成的 personal access token。
- 如果遇到 GitHub API 请求额度限制，或仓库超过约 4 万 stars，可以在页面的 `Token` 输入框填写 token，也可以配置到本机的 `config.local.js`。页面会改用 GitHub GraphQL 查询最新 star 时间，避免 REST 深分页限制。
- 查询公开仓库时，不要给 token 授权写入、删除等高风险权限。优先使用 fine-grained token，并只给公开仓库读取元数据所需的最小权限。

## AI 发现逻辑

GitHub API 没有“全站按最近新增 stars 排序”的直接接口，所以页面会分两步做：

1. 用多条 AI 相关 GitHub Search 查询发现候选仓库。候选来源会覆盖近期活跃、近期新建、总 stars 较高、最近更新等几类项目。
2. 对候选仓库逐个读取 stargazers 时间，计算近 24 小时、近 7 天、近 30 天新增 stars。

因此这个榜单是“AI 候选池内的增长最快项目”，不是 GitHub 全站穷尽扫描。想扩大覆盖面，可以增加搜索条件、提高 `候选数`，或提高本地配置里的 `maxSearchRequests`。

长期使用时，推荐运行本地采集脚本。脚本会定期扫描 AI 项目池，保存 stars 快照到 `data/ai_trends.json`；页面会优先读取这个文件，用快照差值计算 day/week/month 增长。快照积累越久，周榜和月榜越准确。

## 长期趋势采集

先运行一次采集：

```bash
python3 scripts/collect_ai_trends.py --candidate-limit 200 --max-search-requests 48 --max-tracked 500
```

参数含义：

- `--candidate-limit`：每次发现阶段选出多少个 AI 候选项目。
- `--max-search-requests`：GitHub Search API 请求上限，越大覆盖越广。
- `--max-tracked`：长期保留并更新多少个项目。

建议每天跑 1-4 次。Linux/macOS 可以用 cron，例如每天 09:00、15:00、21:00 采集：

```cron
0 9,15,21 * * * cd /data/github && python3 scripts/collect_ai_trends.py --candidate-limit 200 --max-search-requests 48 --max-tracked 500 >> logs/collect.log 2>&1
```

如果用 cron，先创建日志目录：

```bash
mkdir -p logs
```

采集完成后，刷新页面即可看到基于本地快照的增长榜。首次采集只有一个快照，增长值可能为 0；运行满一天后日榜开始有意义，满 7 天后周榜更可靠，满 30 天后月榜更可靠。

## GitHub Actions 定时采集

项目已包含 `.github/workflows/collect-ai-trends.yml`，默认每 30 分钟运行一次，也支持在 GitHub 页面手动触发。

启用步骤：

1. 把项目提交并推送到 GitHub 仓库。
2. 打开仓库的 `Settings` → `Actions` → `General`。
3. 在 `Workflow permissions` 中选择 `Read and write permissions`，允许 workflow 提交 `data/ai_trends.json`。
4. 可选：在 `Settings` → `Secrets and variables` → `Actions` 新增 secret：`AI_TRENDS_TOKEN`。如果不配置，会使用 GitHub Actions 默认的 `GITHUB_TOKEN`。
5. 打开 `Actions` → `Collect AI Stars Trends`，点 `Run workflow` 手动跑一次。

运行成功后，workflow 会自动更新并提交 `data/ai_trends.json`。之后页面读取的就是持续积累的快照数据，你的电脑可以关机。

## Token 怎么填

1. 打开 GitHub 的 token 页面：`Settings` → `Developer settings` → `Personal access tokens`。
2. 新建 fine-grained token 或 classic token。
3. 只查询公开仓库时，选择尽可能小的只读权限；不要勾选写入权限。
4. 复制生成后的 token，粘贴到页面的 `Token` 输入框，或写入 `config.local.js`。

## 本地配置 Token

项目会自动加载 `config.local.js`。把新生成的 token 填到这个文件即可：

```js
window.GITHUB_STARS_CONFIG = {
  token: "github_pat_...",
  source: "ai",
  candidateLimit: 80,
  maxSearchRequests: 24,
  useSnapshots: true,
  snapshotDataUrl: "./data/ai_trends.json",
  aiQueries: [
    "topic:artificial-intelligence stars:>50 archived:false fork:false",
    "topic:llm stars:>50 archived:false fork:false",
    "topic:generative-ai stars:>50 archived:false fork:false",
  ],
};
```

`config.local.js` 是本机私密文件，不要提交、不要截图、不要发给别人。你刚刚发出来的那枚 token 已经暴露过，建议撤销后换一枚新的再填。

如果页面里手动输入了 Token，会优先使用当前标签页 `sessionStorage` 里的值；关闭标签页后会重新使用 `config.local.js`。

## 直接打开

也可以直接打开 `index.html`，但推荐使用本地静态服务运行，浏览器请求和资源路径会更稳定。
