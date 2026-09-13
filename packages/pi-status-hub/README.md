# pi-status-hub

> **A Unified Status Line Management Hub for the Pi Coding Agent.**
> 统一掌管 Pi 底栏状态行，告别多插件状态拥挤打架，提供智能去重、三级自适应降级、独立图标控制与自定义排序。

---

## 🌟 核心特性

- 🛡️ **独占掌控底栏**：全面接管 `ctx.ui.setFooter()`，彻底替代旧版 statusline，告别渲染冲突与频闪。
- 🧭 **完全掌控排序**：系统指标段与扩展插件均支持从左到右任意顺序排列，支持预设与精确顺序。
- 🎨 **图标自由控制**：支持一键关闭所有图标、单独显示某个图标（`icon-only`）、纯文本模式（`text-only`）或自定义图标字符。
- ⚙️ **原生交互设置**：输入 `/shub` 随时调出原生设置列表（类似 `/settings`），随时勾选、切换模式、实时预览并自动保存。
- 🔄 **双轨接入支持**：
  - **Track 1 (被动纳管)**：无需其他插件做任何适配，自动捕获所有调用 `ctx.ui.setStatus()` 的第三方扩展状态。
  - **Track 2 (主动集成)**：通过 `globalThis.__PI_STATUS_HUB__` 支持结构化状态更新。
- 📐 **三级智能折叠降级**：
  - **Stage 1 (宽屏)**：系统指标与扩展徽标单行合并排布，两端对齐。
  - **Stage 2 (中屏)**：低优先级插件自动折叠为仅显示图标（或单行折为两行）。
  - **Stage 3 (窄屏/超载)**：溢出项目自动聚合为 `+N` 徽标。
- 🧼 **智能文本净化**：自动剥离 `sync:` 等冗余前缀，精简常见动词状态（如 `synced` → `✓`）。

---

## 🚀 安装与启用

在 `~/.pi/agent/settings.json` 中配置：

```json
{
  "packages": [
    "../../funnythings/pi_extensions/pi-status-hub"
  ]
}
```

> ⚠️ **注意**：由于 `pi-status-hub` 全量掌管 Footer，若之前安装了 `@narumitw/pi-statusline`，请在 `settings.json` 中移除该项，避免两者抢占底栏。

---

## ⌨️ 交互命令 `/shub`

输入 `/shub` 即可调出全能状态管理列表：

```
⚡ Status Hub · Reorder Statusline (从上到下 ➔ 从左到右)
Top items appear on the LEFT, bottom items appear on the RIGHT:
────────────────────────────────────────────────────────────────────────
▸  1. 📁 cwd               [full     ]  ~/project
   2. 🌿 branch            [full     ]  main
   3. 🧠 model             [full     ]  claude-3-7-sonnet
   4. ⚡ context           [full     ]  15% / 200k
   5. 🤖 subagents         [icon-only]  2 ▶
   6. 🔄 sync              [text-only]  synced
   7. 💰 cost              [full     ]  $0.045
────────────────────────────────────────────────────────────────────────
Controls: ↑/↓ Select  •  Shift+↑/↓ / K/J / u/d Move Up/Down (Left/Right)
Space/Enter: Toggle mode (full → icon-only → text-only → hidden)  •  Esc/q: Save & Close
```

- **上下移动项目（即调整从左到右的顺序）**：
  - 按 **`Shift+↑` / `Shift+↓`**、**`K` / `J`**、或 **`u` / `d`**，即可直接将选中的项目向上或向下移动！
  - **列表里排在上面的项，在底栏里显示在最左边；列表排在下方的项，显示在最右边**！
  - 移动时底栏状态行**实时更新**，所见即所得。
- **切换显示模式**：按 **`Space`** 或 **`Enter`** 循环切换：
  - `full`（图标 + 文本）
  - `icon-only`（**单独显示图标**，隐藏文本）
  - `text-only`（**纯文本**，隐藏图标）
  - `hidden`（**完全隐藏**）
- **快捷开关**：按 `i` 快速全局开关所有图标，按 `s` 快速切换极简/胶囊风格。
- **退出并保存**：按 **`Esc`** 或 **`q`**，配置自动保存到 `~/.pi/agent/pi-status-hub.json`。

---

## ⚙️ 排序与配置文件（可选）

支持从全局 `~/.pi/agent/pi-status-hub.json` 或项目级 `.pi/pi-status-hub.json` 读取：

```json
{
  "style": "minimal",
  "adaptive": true,
  "density": "compact",
  "separator": "dot",
  "showIcons": true,

  "systemSegments": ["model", "branch", "context", "cwd", "cost"],
  "extensionOrder": ["subagents", "sync", "accounts"],

  "iconOnly": ["cwd"],
  "textOnly": ["sync"],
  "hidden": ["caffeinate"],

  "icons": {
    "cwd": "🏠",
    "branch": "🌿"
  },
  "priorities": {
    "subagents": 90,
    "sync": 80
  }
}
```

### 排序机制说明

1. **系统指标顺序 (`systemSegments`)**：
   数组从左到右即底栏显示的绝对物理顺序。例如：`["model", "branch", "cwd"]` 将模型名称排在最左边。
2. **扩展插件顺序 (`extensionOrder` 或 `priorities`)**：
   - **直观数组方式（推荐）**：在 `extensionOrder` 数组中按期望从左到右列出扩展 ID。
   - **权重数值方式**：通过 `priorities` 分配权重（数字越大越靠左）。

---

## 📄 License

MIT
