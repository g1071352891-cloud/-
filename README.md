# Universal AI DM

SillyTavern 第三方扩展：从角色卡与世界书抽取**终极主线**，在玩家任何跑题、杀 NPC、投敌或转入日常时，**重写解法节点**而不是把人拽回去。终局本身不会因为跑题而消失。

## 安装（GitHub 链接）

本扩展按 SillyTavern 第三方扩展规范组织：`manifest.json`、`index.js`、`style.css` 都在**仓库根目录**。把仓库推到 GitHub 后，用链接安装即可，不必拷文件。

1. 新建一个 **Public** 仓库（建议仓库名：`Universal-AI-DM`，酒馆会用这个名字当扩展文件夹）。
2. 推送本仓库的 `main` 分支。
3. 发布后把 `manifest.json` 里的 `homePage` 改成你的仓库地址。
4. 在 SillyTavern：**扩展 → Install Extension（安装扩展）**，粘贴：

```text
https://github.com/<你的用户名>/Universal-AI-DM
```

可选填分支 `main`。本机需要已安装 Git。装完刷新页面，启用 **Universal AI DM**。右下角会出现固定圆形按钮（`bottom: 25px; right: 25px`），开关面板时按钮本身不会位移。

仓库必须公开，否则酒馆那台机器没有 GitHub 凭据时会克隆失败。更新时用扩展管理器的 Update，依赖 `auto_update`。

## 它做什么

| 层 | 作用 |
| --- | --- |
| Grand Endgame | 从世界书最高冲突锁定终局（政变、宗门覆灭、黑预算网等）。不可被跑题擦掉。 |
| Sub-Plot Nodes | 3–5 个里程碑。复杂度可选单线 / 双线 / 网状阴谋。 |
| Entity graph | 绑定核心 NPC、阵营、绝密物品、规则忌讳。 |
| Re-Routing | 旧节点红线划掉，生成 `A′`，让当前行动仍能间接通向终局。 |

每 **N** 轮用户发言，在生成开始前静默运行 `evaluateAndReRoutePlot()`（`generate_interceptor`），并把导演指令注入 **Depth 0 / System**。同时监听 `chat_completion_prompt_ready` 作为双保险。

## 设置

持久化键：`extension_settings.universal_ai_dm`

- **启用动态 DM**
- **导演模型**：复用酒馆主模型，或填写独立 Base URL / Key / Model（OpenAI 兼容，适合长上下文导演）
- **主线复杂度**：单线线性 / 双线交织 / 网状多阵营阴谋
- **重路由敏感度**：越高，越容易因偏离改写后续节点
- **每 N 轮静默推演**
- **注入导演指令**
- **同步 Chat-bound 世界书**（条目 comment 带 `[DM_Dynamic_Node]`）

## 面板

- 顶部：终极主线 / 世界危机卡片
- 中部：里程碑卡片流。失效节点带 `.dm-rerouted` 红线划掉；新节点渐变出现
- 预兆与局势追踪：各阵营因玩家选择产生的暗流
- **剧情一致性审查**：核对近 5 轮是否吃书；若有，`toastr.warning` + 日志里给圆场建议

## 斜杠命令

- `/uadm` 或 `/uadm-eval` — 立即评估并重路由
- `/uadm-rebuild` — 从世界书重建图谱
- `/uadm-review` — 一致性审查

图谱按聊天存在 `chatMetadata.universal_ai_dm` 里，换聊天不会串档。

## 设计原则

- **不按头**：失效节点只划掉，不复活。
- **终局锁死**：重路由只改变接近终局的路径与“投影形态”。
- **缝合进当前场景**：注入文本明确要求顺应玩家，把新线索藏进正在发生的交互里。
