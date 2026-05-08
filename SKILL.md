---
name: ocean-desk
description: OceanBus-powered B-end human agent desk for customer service teams. Use when handling customer inquiries, managing support tickets, assigning work to human agents, or integrating AI skills with human-in-the-loop workflows. Zero server deployment, depends on ocean-chat.
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - node
    emoji: "🖥"
    homepage: https://github.com/ryanbihai/ocean-desk
    envVars:
      - name: OCEANBUS_BASE_URL
        required: false
        description: OceanBus L0 API endpoint. Defaults to public test server.
---

# Ocean Desk — B 端坐席工单系统

Ocean Desk 是 ocean-chat 的上层扩展（类似 ocean-agent），为 B 端服务团队提供人工坐席工单管理。依赖 ocean-chat 的线程协议和 OceanBus SDK 的消息通道。

**核心能力**：工单队列、坐席分配、草稿/发送工作流、快捷回复模板、SLA 追踪。

**两个依赖**：
1. **ocean-chat** — 所有联系人管理和 P2P 消息通过 ocean-chat，本 Skill 不重复实现
2. **oceanbus SDK** — Agent 身份注册、消息收发、线程协议

## 架构

```
AI Skill (health-checkup / doctor-referral)
    │ ocean-thread/v1 create (含结构化 payload)
    ▼
ocean-desk
    ├── tickets.js   — 工单 CRUD + 队列
    ├── agents.js    — 坐席名单 + round-robin 分配
    ├── templates.js — 快捷回复
    └── desk.js      — CLI 入口 + 实时监听
    │
    ▼
ocean-chat (threads.js + SDK)
```

## 触发条件

| 用户说 | 执行 |
|--------|------|
| "查看待处理工单" | `node scripts/desk.js queue` |
| "看看这个工单的详情" | `node scripts/desk.js show <ticket_id>` |
| "把这个工单分给王客服" | `node scripts/desk.js assign <ticket> <agent>` |
| "帮客户起草回复" | `node scripts/desk.js draft <ticket> <msg>` 或 `template use` |
| "发送回复" | `node scripts/desk.js send <ticket>` |
| "关闭这个工单" | `node scripts/desk.js resolve <ticket>` |
| "今天的工单情况" | `node scripts/desk.js stats` |

## 工单工作流

```
AI Skill 创建线程 ──→ listener 自动创建工单 ──→ round-robin 分配坐席
                                                       │
                                                       ▼
                                              坐席查看 show
                                                       │
                                                       ▼
                                              起草回复 draft/template use
                                                       │
                                                       ▼
                                          【人工确认】发送 send ──→ ocean-thread/v1 reply
                                                       │
                                                       ▼
                                              关闭工单 resolve
```

## 命令速查

```bash
# 初始化
node scripts/desk.js setup                       # 注册 desk 身份

# 坐席管理
node scripts/desk.js agent add <名字> <OpenID>    # 添加坐席
node scripts/desk.js agent list                   # 坐席名单
node scripts/desk.js agent toggle <id>            # 启用/停用
node scripts/desk.js agent remove <id>            # 移除坐席

# 工单
node scripts/desk.js queue [--agent <id>]         # 待处理工单
node scripts/desk.js show <ticket_id>             # 工单详情（含 AI 上下文）
node scripts/desk.js assign <ticket> <agent>      # 分配/转派
node scripts/desk.js draft <ticket> <msg>         # 起草回复
node scripts/desk.js send <ticket>               # 发送回复
node scripts/desk.js resolve <ticket>             # 关闭工单
node scripts/desk.js reopen <ticket>             # 重开工单

# 模板
node scripts/desk.js template list                # 模板列表
node scripts/desk.js template use <id> <ticket>   # 套用模板

# 运营
node scripts/desk.js stats                        # 今日工单统计
node scripts/desk.js listen                       # 实时监听新工单
```

## 工单上下文

AI Skill 创建线程时，通过 `payload` 字段透传上下文：

```json
{
  "source_skill": "health-checkup-recommender",
  "customer_profile": { "name": "张先生", "age": 45, "city": "北京" },
  "ai_summary": "已完成项目推荐，客户要求协助预约",
  "recommended_actions": ["预约体检", "确认心血管增强项"],
  "conversation_log": [
    { "role": "ai", "text": "推荐套餐...", "time": "10:28" },
    { "role": "customer", "text": "帮我预约", "time": "10:29" }
  ],
  "priority": "normal"
}
```

`show` 命令会展示所有上下文。坐席不需要翻聊天记录就能了解客户情况。

## 约束规则

1. **人类把关**：所有回复必须先 `draft` 再 `send`，不允许直接发送
2. **先看后回**：回复前必须先 `show` 查看工单上下文和 AI 摘要
3. **SLA 提醒**：`queue` 显示每个工单的 SLA 截止时间，超时工单优先处理
4. **不重复回复**：`send` 发送前检查是否已有草稿，避免重复
5. **记录完整**：每次 `send` 自动记录到 ticket.replies，关闭前确认所有回复已发送
