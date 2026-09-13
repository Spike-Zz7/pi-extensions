# Pi Skill Manager

批量控制 Skill 是否出现在模型可自动调用的技能列表中，同时保留 `/skill:name` 手动调用。

## 安装

需要支持 `disable-model-invocation` 与 TypeScript 扩展的 Pi。

```bash
git clone https://github.com/Eryx-Z/pi-extensions.git ~/.pi/agent/extensions/pi-extensions
```

安装后在 Pi 中执行 `/reload`，然后使用 `/skills-manager`。

更新：

```bash
git -C ~/.pi/agent/extensions/skill-manager pull --ff-only
```

## 使用

支持主命令 **`/manager`**（推荐），同时兼容 `/skills`、`/skill-manager` 与 `/skills-manager`。

### 1. 命令行快速操作（极简零门槛）

- `/manager`：直接打开快速交互式管理界面。
- `/manager <skill名>`：如果匹配具体技能名，**直接翻转**（开 ⇄ 关），立即生效并自动 reload。
- `/manager <关键词...>` 或 `/manager $<关键词...>`：**直接输入就是搜索！**支持按技能名、功能描述、来源等全局搜索，在匹配结果中可一键翻转单个技能或一键全开/全关搜索结果。
- `/manager on <选择器...>`：开启模型自动调用（同 `enable`, `auto`, `auto-on`）。支持 `$关键词` 批量匹配，例如 `/manager on $git`。
- `/manager off <选择器...>`：禁用模型自动调用（同 `disable`, `manual`）。例如 `/manager off $design`。
- `/manager all-on` / `/manager all-off`：**一键全开** 或 **一键全关**。
- `/manager status`：查看简短状态总览（例如：23 个已加载，18 个开启，5 个禁用），不打断输入。
- `/manager list [选择器...]`：查看详细状态列表。
- `/manager groups`：查看所有自动分组与自定义组。

### 2. 交互式管理（TUI）与编辑器即时搜索

- **输入框 `$` 实时搜索补全**：在 Pi 的聊天输入框中，输入 `$`（如 `$git`、`$banner`、`$review`）即可弹出技能智能补全，显示开启/关闭状态与功能简介。
- **`⚡ Quick toggle skill…` 就地搜索**：技能名称置前显示，打开后直接键盘输入任何字符即可实时过滤匹配技能，选中即翻转。
- **`🟢 Turn all skills ON` / `🔴 Turn all skills OFF`**：一键开启或关闭全部技能。
- 自动分组（按来源、作用域）与自定义组管理。

选择器支持：

- 搜索匹配：`$git`、`$review`、`"$pull request"`（名称、描述、来源只要包含即可匹配）
- Skill 名：`brainstorming`（或多个名：`/manager off skill-a skill-b`）
- 通配符：`test-*`、`all`、`*`
- 来源：`source:superpowers`、`source:mattpocock*`
- 范围：`scope:user`、`scope:project`
- 自定义组：`group:quality`

选择器包含空格时使用引号，例如：

```text
/manager off "group:daily work"
/manager on source:claudekit
```

## 自定义组

全局配置：`~/.pi/agent/skill-manager.json`

项目配置：`<project>/.pi/skill-manager.json`。仅在项目已受信任时读取；项目同名组覆盖全局组。从子目录启动时优先使用最近的项目 `.pi`，没有 `.pi` 时使用 Git 根目录；非 Git 目录使用当前目录。

在 TUI 中选择 “Manage custom groups…”，再选择 Global 或 Project 作用域，可以：

- 新建组
- 编辑选择器（每行一个）
- 重命名组；同一配置文件中的 `group:旧名` 引用会同步更新
- 删除组；如果当前可见的其他组仍在引用它，删除会被阻止

自动生成的 Source、Scope 和 All skills 组是只读的。组配置修改立即生效，不需要 reload。项目组入口仅在项目受信任时显示。

```json
{
  "groups": {
    "quality": [
      "brainstorming",
      "test-*",
      "scope:project"
    ]
  }
}
```

扩展通过修改 Skill frontmatter 中的 `disable-model-invocation` 实现切换，并在成功后自动 reload。第三方 Skill 包升级可能覆盖该字段。
