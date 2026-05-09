---
name: ocean-desk
description: Backend human-agent desk infrastructure for OceanBus brand agents. Not customer-facing — used by brand agents to escalate to human operators. Responds to -humanservice command. Depends on ocean-chat. npm install oceanbus.
version: 1.1.0
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

# Ocean Desk — 品牌 Agent 的人工坐席基础设施

Ocean Desk 是**乙方品牌 Agent 的底层工单系统**，不是面向客户的产品。

```
客户                   品牌 Agent                  ocean-desk（隐藏）
 ────                   ────────                   ────────
"帮我预约专家"    →    china-top-doctor
                      搜专家、比价
                      客户确认预约
                      触发转人工 ──────────────→   创建工单
                                                  round-robin 分配
                                                  "张先生预约许文兵教授"
                      客户无感 ←────────────────  坐席处理
                      "已帮您预约"
```

## 定位原则

1. **不 publish 到黄页**。客户通过 find-agent 搜不到 ocean-desk。
2. **不直接接收客户消息**。所有客户对话通过品牌 Agent 中转。
3. 品牌 Agent 决定何时转人工、传给 ocean-desk 什么上下文。

---

## 品牌 Agent 对接方式

品牌 Agent 在自己内部配置 ocean-desk 的 OpenID（写死在 config 里），两种方式触发：

### 方式一：品牌 Agent 主动触发

品牌 Agent 判断需要人工介入时（如客户说"帮我预约"但 Agent 不能直接操作预约系统），内部发 ocean-thread/v1 create 给 ocean-desk：

```bash
# 品牌 Agent 内部调用（客户不感知）
node chat.js send <desk-openid> --protocol ocean-thread/v1 '{
  "action": "create",
  "subject": "专家预约 — 张先生 消化科 北京",
  "payload": {
    "source_skill": "china-top-doctor-referral",
    "customer_name": "张先生",
    "ai_summary": "推荐许文兵教授，消化科，周三上午。客户确认预约。",
    "recommended_actions": ["预约许文兵教授 周三上午"]
  }
}'
```

### 方式二：`-humanservice` 命令

品牌 Agent 的 `-help` 响应中声明支持 `-humanservice`。主控 LLM 需要人工时，直接向品牌 Agent 发 `-humanservice`：

```
主控 LLM                 品牌 Agent                  ocean-desk
────────                ────────                   ────────
"帮客户预约专家"
发 -humanservice  →     
                       收到，转人工    ──────────→   创建工单
                       返回工单号                  分配坐席
                       "已转人工，#TK-042"
  ← 展示给客户
  "已帮您转人工，工单 TK-042"
```

品牌 Agent 收到 `-humanservice` 时：
1. 整理当前对话上下文（客户是谁、聊了什么、需要做什么）
2. 发 ocean-thread/v1 create 给 ocean-desk
3. 返回客户 `"已转人工坐席，工单号 XXX，稍后联系您"`

---

## 两个 OceanBus 协议

| 命令 | 方向 | 含义 |
|------|------|------|
| `-help` | 任何人 → 品牌 Agent | 返回能力描述（含"支持人工：发送 -humanservice"） |
| `-humanservice` | 主控 LLM → 品牌 Agent | 触发人工坐席，返回工单号 |

品牌 Agent 在 `-help` 响应中必须声明：
```
✋ 人工服务：发送 -humanservice，我会帮你转接人工坐席
```

---

## 工单工作流（ocean-desk 内部）

```
品牌 Agent 发 ocean-thread/v1 create
  → listener 自动创建工单
  → round-robin 分配坐席
  → 坐席查看 show（含完整 AI 上下文）
  → 起草回复 draft / template use
  → 【人工确认】发送 send → ocean-thread/v1 reply → 品牌 Agent → 客户
  → 关闭工单 resolve
```

---

## 命令速查

```bash
# 初始化
node scripts/desk.js setup                       # 注册 desk 身份

# 坐席管理
node scripts/desk.js agent add <名字> <OpenID>    # 添加坐席
node scripts/desk.js agent list                   # 坐席名单
node scripts/desk.js agent toggle <id>            # 启用/停用

# 工单
node scripts/desk.js queue                        # 待处理工单（紧急优先）
node scripts/desk.js show <ticket_id>             # 工单详情 + AI 上下文
node scripts/desk.js assign <ticket> <agent>      # 分配/转派
node scripts/desk.js draft <ticket> <msg>         # 起草回复
node scripts/desk.js send <ticket>                # 发送回复
node scripts/desk.js resolve <ticket>             # 关闭工单
node scripts/desk.js reopen <ticket>              # 重开工单

# 快捷回复
node scripts/desk.js template list                # 模板列表
node scripts/desk.js template use <id> <ticket>   # 套用模板

# 监听
node scripts/desk.js listen                       # 实时监听新工单
node scripts/desk.js stats                        # 今日统计
```

---

## 与 find-agent / ocean-chat 的关系

```
find-agent          ocean-chat            ocean-desk
  (发现品牌Agent)     (消息通道)            (隐藏基础设施)
      │                   │                      │
  搜黄页 → 发 -help → 品牌Agent回复能力 ──→ 需要人工时触发
                           │
                    发 -humanservice ──────→ 创建工单、分配坐席
```

ocean-desk 不 publish 到黄页，不出现在客户面前。它是品牌 Agent 的私有基础设施。
