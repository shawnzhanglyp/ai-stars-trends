# GitHub 同步指令

本项目远端仓库：

```bash
https://github.com/shawnzhanglyp/ai-stars-trends.git
```

以下命令默认在项目目录执行：

```bash
cd /data/github
```

## 查看当前状态

```bash
git status --short --branch
git log --oneline --max-count=5
git remote -v
```

常见状态含义：

- `main...origin/main`：本地和 GitHub 已同步。
- `main...origin/main [领先 1]`：本地有 1 个提交还没有推到 GitHub。
- `main...origin/main [落后 1]`：GitHub 有 1 个提交本地还没有下载。

## 上传本地代码到 GitHub

推荐流程：

```bash
git status --short
git add app.js index.html README.md scripts data .github
git commit -m "Describe your change"
git pull --rebase origin main
git push origin main
```

如果只想提交所有已跟踪文件的修改，也可以用：

```bash
git add -u
git commit -m "Describe your change"
git pull --rebase origin main
git push origin main
```

如果新增了新文件，例如新建了这个文档，需要显式 `git add`：

```bash
git status --short
git add GITHUB_SYNC.md
git commit -m "Add GitHub sync guide"
git pull --rebase origin main
git push origin main
```

推送时如果终端要求登录：

```text
Username: shawnzhanglyp
Password: 粘贴 GitHub Personal Access Token，不是 GitHub 登录密码
```

注意：浏览器已经登录 GitHub，并不等于终端里的 `git push` 已经登录。

## 从 GitHub 下载最新代码

GitHub Actions 会定时更新 `data/ai_trends.json`，所以本地开发前建议先同步远端：

```bash
git fetch origin
git pull --ff-only origin main
```

`--ff-only` 表示只允许快进更新：如果你本地没有额外提交，它会把 GitHub 的最新提交直接下载到本地；如果本地和远端已经分叉，它会停止并提示你处理，避免自动产生多余的 merge commit。

如果你本地已经有未推送的提交，需要把本地提交叠到 GitHub 最新提交之后，用：

```bash
git pull --rebase origin main
```

如果你本地有尚未提交的修改，先查看：

```bash
git status --short
```

本地修改想保留并继续开发：

```bash
git add -u
git commit -m "Save local changes"
git pull --rebase origin main
```

本地修改暂时不想提交：

```bash
git stash push -m "work in progress"
git pull --rebase origin main
git stash pop
```

## 处理 fetch first / non-fast-forward

如果 `git push origin main` 出现类似提示：

```text
! [rejected] main -> main (fetch first)
```

说明 GitHub 上已经有本地没有的新提交。通常是 GitHub Actions 更新了 `data/ai_trends.json`。

处理方式：

```bash
git fetch origin
git rebase origin/main
git push origin main
```

如果 rebase 过程中出现冲突：

```bash
git status
```

打开冲突文件，手动保留需要的内容后：

```bash
git add 冲突文件路径
git rebase --continue
git push origin main
```

如果想放弃本次 rebase：

```bash
git rebase --abort
```

## 使用 push.local.env 中的 Token

`push.local.env` 已被 `.gitignore` 忽略，不会提交到 GitHub。它可以保存本机私有 token：

```bash
source push.local.env
```

推荐优先使用交互式推送：

```bash
git push origin main
```

当终端要求 `Password` 时，粘贴 token。

不建议把 token 写入 `git remote set-url`，也不要把 token 提交到仓库、截图或发给别人。

## Token 暴露后的处理

如果 token 曾经出现在聊天、截图、终端录屏或提交历史里，应立即到 GitHub 撤销这枚 token，然后新建一枚。

路径：

```text
GitHub -> Settings -> Developer settings -> Personal access tokens
```

新 token 只给本项目需要的最小权限。用于推送代码通常需要仓库写入权限；如果需要改 GitHub Actions workflow，还需要 workflow 相关权限。
