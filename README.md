# 🖥 Ocean Desk — B 端坐席工单系统

**AI skill 转人工的最后一步。给客服团队一个工单看板：谁在排队、谁在处理、SLA 还剩多久。**

[![ClawHub](https://img.shields.io/badge/ClawHub-ocean--desk-blue)](https://clawhub.ai/skills/ocean-desk)
[![license](https://img.shields.io/badge/license-MIT--0-green)](LICENSE)
[![OceanBus](https://img.shields.io/badge/OceanBus-v0.4.0-1f6feb)](https://www.npmjs.com/package/oceanbus)

---

## 它解决什么

一个客服团队每天面对的混乱：

| 痛点 | 没有 Ocean Desk 时 | 有了之后 |
|------|-------------------|---------|
| **AI 转人工断档** | AI 推荐完，客服看到的是孤零零一条消息，不知道上下文 | AI skill 把完整的客户画像、对话历史、建议操作打包传给坐席 |
| **工单分配混乱** | 谁看见谁回，有的客户等一天没人理 | round-robin 自动分配，sick 或者没人在岗也能看到积压 |
| **多件事混着聊** | 两个人同时在说 3 件事，消息串行分不清 | 每条工单绑定一个 ocean-thread，对话线程天然隔离 |
| **不知道谁该先回** | 凭感觉挑着回 | 紧急工单排前面，每个工单显示 SLA 剩余时间 |
| **每次重复打字** | 每个客户都要重新想开场白 | 快捷回复模板，一键套用，变量自动填充 |

---

## 三步跑通

### 1. 安装

```bash
# Ocean Desk 是 ocean-chat 的扩展
clawhub install ocean-chat    # 如果没有 ocean-chat，先装
clawhub install ocean-desk

# 安装依赖
cd ~/.openclaw/workspace/skills/ocean-desk
npm install
```

### 2. 配置坐席团队

```bash
# 初始化 desk 身份
node scripts/desk.js setup

# 添加坐席（每个人的 OceanBus OpenID）
node scripts/desk.js agent add 王小明 ob_agent_wang_xxxx
node scripts/desk.js agent add 李小红 ob_agent_li_xxxx

# 查看坐席名单
node scripts/desk.js agent list
```

### 3. 启动监听 + 开始处理工单

```bash
# 启动实时监听（保持运行）
node scripts/desk.js listen

# 另一个窗口：查看待处理工单
node scripts/desk.js queue

# 查看工单详情 + AI 上下文
node scripts/desk.js show tk_20260508_abc123

# 套用模板起草回复
node scripts/desk.js template use tpl_greeting tk_20260508_abc123

# 发送回复
node scripts/desk.js send tk_20260508_abc123

# 关闭工单
node scripts/desk.js resolve tk_20260508_abc123
```

---

## 架构

```
AI Skill (health-checkup / doctor-referral)
    │  ocean-thread/v1 create
    │  payload: { customer_profile, ai_summary, conversation_log }
    ▼
┌──────────────────────────────┐
│     Ocean Desk               │
│  ┌────────┐  ┌───────────┐   │
│  │ 工单队列 │  │ 坐席分配   │   │
│  │ 优先级  │  │ round-robin │  │
│  │ SLA    │  │ 技能匹配    │  │
│  └───┬────┘  └─────┬─────┘   │
│      │              │        │
│  ┌───▼──────────────▼──────┐ │
│  │  回复工作流              │ │
│  │  draft → confirm → send │ │
│  └─────────────────────────┘ │
└──────────────┬───────────────┘
               │
    ┌──────────▼──────────┐
    │  ocean-chat threads │
    │  + OceanBus SDK     │
    └─────────────────────┘
```

---

## 命令速查

| 命令 | 用途 |
|------|------|
| `setup` | 初始化 desk + 注册 OceanBus 身份 |
| `agent add <name> <openid>` | 添加坐席 |
| `agent list` | 坐席名单 |
| `agent toggle <id>` | 启用/停用坐席 |
| `queue` | 待处理工单（紧急优先） |
| `show <ticket_id>` | 工单详情 + AI 上下文 + 对话记录 |
| `assign <ticket> <agent>` | 分配/转派工单 |
| `draft <ticket> <msg>` | 起草回复 |
| `send <ticket>` | 确认发送回复 |
| `resolve <ticket>` | 关闭工单 |
| `reopen <ticket>` | 重开工单 |
| `template list` | 快捷回复模板列表 |
| `template use <id> <ticket>` | 套用模板起草 |
| `stats` | 今日统计 |
| `listen` | 实时监听新工单 |

## ⚠️ 前置依赖

**ocean-desk 不是独立应用 — 它基于 ocean-chat 的线程协议。**

| 依赖 | 说明 |
|------|------|
| [ocean-chat](https://clawhub.ai/skills/ocean-chat) | **必装**。提供线程协议 (ocean-thread/v1)、消息收发、Roster 通讯录 |
| [OceanBus SDK](https://www.npmjs.com/package/oceanbus) | ocean-chat 自带，无需单独安装 |

安装顺序：先 `clawhub install ocean-chat`，注册并验证消息可用，再安装 `ocean-desk`。

## 跟 ocean-chat 的关系

| | ocean-chat | ocean-desk |
|---|---|---|
| 定位 | P2P 消息 + 通讯录 + 线程协议 | 客服坐席工单系统 |
| 适合谁 | 所有 OceanBus 用户 | 客服团队 / B 端服务团队 |
| 工单管理 | 无 | 有（队列、分配、SLA、模板） |
| 线程 | 线程协议实现者 | 线程协议消费者（工单包裹线程） |

---

## 相关项目

| 项目 | 说明 |
|------|------|
| [ocean-chat](https://github.com/ryanbihai/ocean-chat) | OceanBus 通讯录 + 消息 + 线程协议 |
| [health-checkup-recommender](https://github.com/ryanbihai/health-checkup-recommender) | 体检推荐 AI skill，支持转接 ocean-desk |
| [china-top-doctor-referral](https://github.com/ryanbihai/china-top-doctor-referral) | 专家推荐 AI skill，支持转接 ocean-desk |
| [ocean-agent](https://github.com/ryanbihai/ocean-agent) | 保险代理人工作台，同样依赖 ocean-chat |
| [oceanbus](https://www.npmjs.com/package/oceanbus) | OceanBus SDK — 注册、消息、黄页、声誉 |

---

## 数据存储

```
~/.oceanbus-desk/
├── credentials.json     # desk 的 OceanBus 身份
├── config.json          # 坐席名单 + 排班配置
├── tickets.json         # 工单数据（每个工单 1:1 绑定线程）
└── templates.json       # 快捷回复模板
```

---

*OceanBus 生态项目 · MIT-0 协议*
