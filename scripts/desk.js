#!/usr/bin/env node
'use strict';

// Ocean Desk — B-end human agent desk for customer service
//
// Depends on ocean-chat for thread/messaging and oceanbus SDK for transport.
// Each ticket wraps a thread_id (1:1 mapping). Thread stores conversation
// timeline; ticket stores queue state, assignment, and SLA tracking.
//
// Commands:
//   node scripts/desk.js setup                       Initialize desk + register
//   node scripts/desk.js agent add <name> <openid>   Add human agent to roster
//   node scripts/desk.js agent list                  List all agents
//   node scripts/desk.js agent toggle <id>           Toggle agent active/inactive
//   node scripts/desk.js queue [--agent <id>]        Show pending tickets
//   node scripts/desk.js show <ticket_id>            Show ticket detail
//   node scripts/desk.js assign <ticket> <agent>     Assign/reassign ticket
//   node scripts/desk.js draft <ticket> <message>    Draft a reply
//   node scripts/desk.js send <ticket>               Send drafted reply
//   node scripts/desk.js resolve <ticket>            Close ticket
//   node scripts/desk.js reopen <ticket>             Reopen closed ticket
//   node scripts/desk.js template list               List templates
//   node scripts/desk.js template use <id> <ticket>  Apply template
//   node scripts/desk.js stats                       Show desk statistics
//   node scripts/desk.js listen                      Start listener

const { createOceanBus } = require('oceanbus');
const agents = require('./agents');
const tickets = require('./tickets');
const templates = require('./templates');
const threads = require('../../ocean-chat/threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.oceanbus-desk');
const CRED_FILE = path.join(DATA_DIR, 'credentials.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCredentials() {
  if (!fs.existsSync(CRED_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8')); } catch (_) { return null; }
}

function saveCredentials(agentId, apiKey, openid) {
  ensureDir();
  fs.writeFileSync(CRED_FILE, JSON.stringify({
    agent_id: agentId, api_key: apiKey, openid,
    created_at: new Date().toISOString(),
  }, null, 2));
}

function shortId(openid) {
  return openid ? openid.slice(0, 14) + '...' : '';
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function cmdSetup() {
  ensureDir();

  const existing = loadCredentials();
  if (existing) {
    console.log('已注册。Desk OpenID: ' + existing.openid);
    console.log('(简写: ' + shortId(existing.openid) + ')');
    console.log('');
    const roster = agents.listAgents();
    if (roster.length === 0) {
      console.log('尚未添加坐席。运行: node scripts/desk.js agent add <名字> <OpenID>');
    } else {
      console.log('坐席名单 (' + roster.length + ' 人):');
      for (const a of roster) {
        console.log('  ' + (a.active ? '🟢' : '⚫') + ' ' + a.name + ' (' + a.id + ')');
      }
    }
    return;
  }

  console.log('正在注册 OceanBus 身份...');
  const ob = await createOceanBus({ keyStore: { type: 'memory' } });
  let openid;
  try {
    const reg = await ob.register();
    openid = await ob.getOpenId();
    saveCredentials(reg.agent_id, reg.api_key, openid);
    agents.setDeskOpenid(openid);
  } catch (e) {
    console.error('注册失败: ' + e.message);
    await ob.destroy();
    process.exit(1);
  }
  await ob.destroy();

  console.log('');
  console.log('Ocean Desk 注册成功！');
  console.log('');
  console.log('你的 Desk OpenID: ' + openid);
  console.log('');
  console.log('下一步:');
  console.log('  ① 添加坐席: node scripts/desk.js agent add <名字> <OpenID>');
  console.log('  ② 启动监听: node scripts/desk.js listen');
  console.log('  ③ AI skill 转人工时，发送 ocean-thread/v1 create 到此 OpenID');
}

// ── Agent ─────────────────────────────────────────────────────────────────────

async function cmdAgent(sub, arg1, arg2) {
  if (sub === 'add') {
    if (!arg1 || !arg2) {
      console.log('用法: node scripts/desk.js agent add <名字> <OpenID>');
      return;
    }
    const result = agents.addAgent(arg1, arg2);
    if (result.ok) {
      console.log('已添加坐席: ' + result.agent.name + ' (' + result.agent.id + ')');
    } else {
      console.log('添加失败: ' + result.msg);
    }
  } else if (sub === 'list') {
    const list = agents.listAgents();
    if (list.length === 0) {
      console.log('坐席名单为空。');
      return;
    }
    console.log('坐席名单 (' + list.length + ' 人):');
    for (const a of list) {
      const status = a.active ? '🟢 在岗' : '⚫ 离线';
      const skills = a.skills.length ? ' [' + a.skills.join(', ') + ']' : '';
      console.log('  ' + status + ' ' + a.name + ' (' + a.id + ')' + skills);
      console.log('    OpenID: ' + shortId(a.openid));
    }
  } else if (sub === 'toggle') {
    if (!arg1) { console.log('用法: node scripts/desk.js agent toggle <agent_id>'); return; }
    const a = agents.toggleAgent(arg1);
    if (!a) { console.log('坐席不存在: ' + arg1); return; }
    console.log((a.active ? '🟢 已启用' : '⚫ 已停用') + ' ' + a.name);
  } else if (sub === 'remove') {
    if (!arg1) { console.log('用法: node scripts/desk.js agent remove <agent_id>'); return; }
    if (agents.removeAgent(arg1)) {
      console.log('已移除坐席: ' + arg1);
    } else {
      console.log('坐席不存在: ' + arg1);
    }
  } else {
    console.log('agent 子命令: add | list | toggle | remove');
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────

function cmdQueue(agentId) {
  const queue = tickets.getQueue(agentId || null);
  if (queue.length === 0) {
    console.log('暂无待处理工单。');
    return;
  }

  const cfg = agents.getConfig();
  console.log(cfg.desk_name || 'Ocean Desk');
  console.log('待处理工单 (' + queue.length + '):\n');

  for (const t of queue) {
    const priority = t.priority === 'urgent' ? '🔴 紧急' : '🟡 普通';
    const status = t.status === 'pending' ? '待分配' : '处理中';
    const agent = t.assigned_agent
      ? (agents.findAgent(t.assigned_agent)?.name || t.assigned_agent)
      : '未分配';
    const created = new Date(t.created_at).toLocaleTimeString('zh-CN', { hour12: false });
    const sla = t.sla_deadline ? ' | SLA: ' + new Date(t.sla_deadline).toLocaleTimeString('zh-CN', { hour12: false }) : '';

    console.log('  ' + t.ticket_id.slice(0, 14) + '...  ' + priority + ' ' + status);
    console.log('    ' + t.subject);
    console.log('    来源: ' + (t.source_skill || '—') + ' | 坐席: ' + agent + ' | ' + created + sla);
    if (t.draft) console.log('    📝 草稿: ' + t.draft.slice(0, 50) + '...');
    console.log('');
  }
}

// ── Show ──────────────────────────────────────────────────────────────────────

function cmdShow(ticketId) {
  if (!ticketId) { console.log('用法: node scripts/desk.js show <ticket_id>'); return; }

  const t = tickets.getTicket(ticketId);
  if (!t) { console.log('工单不存在: ' + ticketId); return; }

  const statusIcon = { pending: '🟡', active: '🟢', resolved: '✅' };
  const priorityIcon = t.priority === 'urgent' ? '🔴 紧急' : '🟡 普通';
  const agent = t.assigned_agent
    ? (agents.findAgent(t.assigned_agent)?.name || t.assigned_agent)
    : '未分配';
  const created = new Date(t.created_at).toLocaleString('zh-CN');

  console.log('工单: ' + t.subject);
  console.log('ID: ' + t.ticket_id + ' | 线程: ' + (t.thread_id || '').slice(0, 14) + '...');
  console.log('状态: ' + (statusIcon[t.status] || '') + ' ' + t.status +
    ' | ' + priorityIcon + ' | 坐席: ' + agent);
  console.log('来源: ' + (t.source_skill || '—') + ' | 创建: ' + created);
  if (t.sla_deadline) {
    console.log('SLA 截止: ' + new Date(t.sla_deadline).toLocaleString('zh-CN'));
  }
  console.log('');

  // AI context
  if (t.context && (t.context.customer_profile?.name || t.context.ai_summary)) {
    console.log('── AI 上下文 ──');
    if (t.context.customer_profile) {
      console.log('客户画像: ' + JSON.stringify(t.context.customer_profile));
    }
    if (t.context.ai_summary) {
      console.log('AI 摘要: ' + t.context.ai_summary);
    }
    if (t.context.recommended_actions && t.context.recommended_actions.length) {
      console.log('建议操作: ' + t.context.recommended_actions.join(' | '));
    }
    if (t.context.conversation_log && t.context.conversation_log.length) {
      console.log('对话记录:');
      for (const m of t.context.conversation_log) {
        const role = m.role === 'ai' ? '🤖' : m.role === 'customer' ? '👤' : '📝';
        console.log('  ' + role + ' ' + (m.time || '') + ' ' + m.text);
      }
    }
    console.log('');
  }

  // Thread messages (from threads module)
  if (t.thread_id) {
    const th = threads.getThread(t.thread_id);
    if (th && th.messages.length > 0) {
      console.log('── 线程消息 ──');
      for (const m of th.messages) {
        const dir = m.direction === 'sent' ? '→' : '←';
        const time = new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
        console.log('  ' + dir + ' ' + time + '  ' + m.content);
      }
      console.log('');
    }
  }

  // Replies
  if (t.replies.length > 0) {
    console.log('── 回复记录 ──');
    for (const r of t.replies) {
      const dir = r.direction === 'sent' ? '→' : '←';
      const time = new Date(r.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
      console.log('  ' + dir + ' ' + time + '  ' + r.content);
    }
    console.log('');
  }

  // Draft
  if (t.draft) {
    console.log('── 草稿 ──');
    console.log('  ' + t.draft);
    console.log('');
    console.log('发送: node scripts/desk.js send ' + t.ticket_id);
  }
}

// ── Assign ────────────────────────────────────────────────────────────────────

function cmdAssign(ticketId, agentId) {
  if (!ticketId || !agentId) { console.log('用法: node scripts/desk.js assign <ticket_id> <agent_id|agent_name>'); return; }

  const t = tickets.getTicket(ticketId);
  if (!t) { console.log('工单不存在: ' + ticketId); return; }
  const a = agents.findAgent(agentId);
  if (!a) { console.log('坐席不存在: ' + agentId); return; }
  if (!a.active) { console.log('坐席已离线: ' + a.name); return; }

  tickets.assignTicket(t.ticket_id, a.id);
  console.log('已分配 [' + t.ticket_id.slice(0, 14) + '...] → ' + a.name + ' (' + a.id + ')');
}

// ── Draft / Send ──────────────────────────────────────────────────────────────

function cmdDraft(ticketId, message) {
  if (!ticketId || !message) { console.log('用法: node scripts/desk.js draft <ticket_id> <消息>'); return; }

  const t = tickets.getTicket(ticketId);
  if (!t) { console.log('工单不存在: ' + ticketId); return; }
  if (t.status === 'resolved') { console.log('工单已关闭。请先重开: node scripts/desk.js reopen ' + ticketId); return; }

  tickets.addDraft(t.ticket_id, message);
  console.log('已保存草稿 → ' + t.ticket_id.slice(0, 14) + '...');
  console.log('确认发送: node scripts/desk.js send ' + t.ticket_id);
}

async function cmdSend(ticketId) {
  const creds = loadCredentials();
  if (!creds) { console.log('尚未注册。运行: node scripts/desk.js setup'); return; }
  if (!ticketId) { console.log('用法: node scripts/desk.js send <ticket_id>'); return; }

  const t = tickets.getTicket(ticketId);
  if (!t) { console.log('工单不存在: ' + ticketId); return; }
  if (!t.draft) { console.log('没有草稿。先起草: node scripts/desk.js draft ' + ticketId + ' <消息>'); return; }

  // Send via ocean-thread/v1 reply protocol
  const agent = t.assigned_agent ? agents.findAgent(t.assigned_agent) : null;
  const agentName = agent?.name || '坐席';

  const msg = JSON.stringify({
    type: 'protocol',
    protocol: 'ocean-thread/v1',
    structured: {
      action: 'reply',
      thread_id: t.thread_id,
      subject: t.subject,
      payload: {
        text: t.draft,
        agent_name: agentName,
        ticket_id: t.ticket_id,
      },
    },
  });

  const ob = await createOceanBus({
    keyStore: { type: 'memory' },
    identity: { agent_id: creds.agent_id, api_key: creds.api_key },
  });

  // Find participant from the thread
  const th = threads.getThread(t.thread_id);
  if (th) {
    await ob.send(th.participant, msg);
    tickets.addReply(t.ticket_id, t.draft, 'sent');
    // Also record in thread
    threads.addMessage(t.thread_id, 'sent', t.draft, null);
    console.log('已发送回复 → ' + (th.participant_name || shortId(th.participant)));
  } else {
    console.log('线程不存在: ' + t.thread_id);
  }

  await ob.destroy();
}

// ── Resolve / Reopen ──────────────────────────────────────────────────────────

async function cmdResolve(ticketId) {
  const creds = loadCredentials();
  if (!creds) { console.log('尚未注册。运行: node scripts/desk.js setup'); return; }
  if (!ticketId) { console.log('用法: node scripts/desk.js resolve <ticket_id>'); return; }

  const t = tickets.getTicket(ticketId);
  if (!t) { console.log('工单不存在: ' + ticketId); return; }

  tickets.resolveTicket(t.ticket_id);

  if (t.thread_id) {
    const msg = JSON.stringify({
      type: 'protocol',
      protocol: 'ocean-thread/v1',
      structured: { action: 'resolve', thread_id: t.thread_id, subject: t.subject },
    });
    const ob = await createOceanBus({
      keyStore: { type: 'memory' },
      identity: { agent_id: creds.agent_id, api_key: creds.api_key },
    });
    const th = threads.getThread(t.thread_id);
    if (th) await ob.send(th.participant, msg);
    await ob.destroy();
  }

  console.log('✅ 已关闭工单: ' + t.subject);
}

async function cmdReopen(ticketId) {
  const creds = loadCredentials();
  if (!creds) { console.log('尚未注册。运行: node scripts/desk.js setup'); return; }
  if (!ticketId) { console.log('用法: node scripts/desk.js reopen <ticket_id>'); return; }

  const ok = tickets.reopenTicket(ticketId);
  if (!ok) { console.log('工单不存在或未关闭: ' + ticketId); return; }

  const t = tickets.getTicket(ticketId);

  if (t.thread_id) {
    const msg = JSON.stringify({
      type: 'protocol',
      protocol: 'ocean-thread/v1',
      structured: { action: 'reopen', thread_id: t.thread_id, subject: t.subject },
    });
    const ob = await createOceanBus({
      keyStore: { type: 'memory' },
      identity: { agent_id: creds.agent_id, api_key: creds.api_key },
    });
    const th = threads.getThread(t.thread_id);
    if (th) await ob.send(th.participant, msg);
    await ob.destroy();
  }

  console.log('🔄 已重开工单: ' + t.subject);
}

// ── Template ──────────────────────────────────────────────────────────────────

function cmdTemplate(sub, arg1, arg2) {
  if (sub === 'list') {
    const all = templates.listTemplates();
    const cats = {};
    for (const t of all) {
      if (!cats[t.category]) cats[t.category] = [];
      cats[t.category].push(t);
    }
    for (const [cat, items] of Object.entries(cats)) {
      console.log('── ' + cat + ' ──');
      for (const t of items) {
        console.log('  ' + t.id + '  ' + t.label);
      }
    }
  } else if (sub === 'use') {
    if (!arg1 || !arg2) { console.log('用法: node scripts/desk.js template use <template_id> <ticket_id>'); return; }

    const ticket = tickets.getTicket(arg2);
    if (!ticket) { console.log('工单不存在: ' + arg2); return; }
    const agent = ticket.assigned_agent ? agents.findAgent(ticket.assigned_agent) : null;

    const vars = {
      agent_name: agent?.name || '客服',
      subject: ticket.subject,
      customer_name: ticket.context?.customer_profile?.name || ticket.customer_name || '客户',
      details: ticket.context?.ai_summary || ticket.subject,
    };

    const text = templates.applyTemplate(arg1, vars);
    if (!text) { console.log('模板不存在: ' + arg1); return; }

    tickets.addDraft(ticket.ticket_id, text);
    console.log('已套用模板 → 草稿:');
    console.log('  ' + text);
    console.log('');
    console.log('确认发送: node scripts/desk.js send ' + ticket.ticket_id);
  } else if (sub === 'add') {
    if (!arg1 || !arg2) { console.log('用法: node scripts/desk.js template add <label> <text> [category]'); return; }
    const id = templates.addTemplate(arg1, arg2, process.argv[process.argv.indexOf('template') + 4] || '自定义');
    console.log('已添加模板: ' + id);
  } else {
    console.log('template 子命令: list | use <id> <ticket> | add <label> <text>');
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function cmdStats() {
  const stats = tickets.getStats();
  const cfg = agents.getConfig();
  console.log(cfg.desk_name || 'Ocean Desk');
  console.log('');
  console.log('今日工单: ' + stats.today_total + ' | 已解决: ' + stats.today_resolved);
  console.log('待分配: ' + stats.pending + ' | 处理中: ' + stats.active);
  console.log('累计解决: ' + stats.resolved_total);
  if (stats.sla_breached > 0) {
    console.log('⚠ SLA 超时: ' + stats.sla_breached);
  }
  const roster = agents.listAgents();
  console.log('在岗坐席: ' + roster.filter(a => a.active).length + '/' + roster.length);
}

// ── Listen ────────────────────────────────────────────────────────────────────

async function cmdListen() {
  const creds = loadCredentials();
  if (!creds) { console.log('尚未注册。运行: node scripts/desk.js setup'); return; }

  const ob = await createOceanBus({
    keyStore: { type: 'memory' },
    identity: { agent_id: creds.agent_id, api_key: creds.api_key },
  });

  const roster = agents.listAgents();

  console.log('[Ocean Desk] 实时监听中... 按 Ctrl+C 停止');
  console.log('坐席在岗: ' + roster.filter(a => a.active).length + '/' + roster.length + '\n');

  ob.startListening(async (msg) => {
    const parsed = (() => {
      try { return JSON.parse(msg.content); } catch (_) { return null; }
    })();
    if (!parsed || parsed.type !== 'protocol' || parsed.protocol !== 'ocean-thread/v1') return;
    if (!parsed.structured) return;

    const s = parsed.structured;

    // Only handle 'create' from external sources (not our own outbound)
    if (s.action === 'create') {
      // Register the thread locally
      const participantName = '客户'; // Will be resolved from Roster later
      const result = threads.handleThreadProtocol(msg, true, participantName);
      if (!result) return;

      // Check if we already have a ticket for this thread
      const existing = tickets.listTickets().find(tk => tk.thread_id === result.thread_id);
      if (existing) {
        console.log('[重复] 线程 ' + result.thread_id.slice(0, 14) + '... 已有工单 ' + existing.ticket_id.slice(0, 14) + '...');
        return;
      }

      // Create ticket
      const skill = s.payload?.source_skill || '';
      const ticketId = tickets.createTicket(result.thread_id, s.subject, s.payload);

      // Auto-assign via round-robin (filtered by skill)
      const agent = agents.getNextAgent(skill || null);
      if (agent) {
        tickets.assignTicket(ticketId, agent.id);
      }

      const priorityIcon = s.payload?.priority === 'urgent' ? '🔴' : '🟡';
      console.log(priorityIcon + ' [新工单] ' + ticketId.slice(0, 14) + '...');
      console.log('  主题: ' + s.subject);
      console.log('  来源: ' + (skill || '未知'));
      console.log('  分配: ' + (agent ? agent.name + ' (' + agent.id + ')' : '未分配（无在岗坐席）'));
      console.log('');

      // Also handle the protocol locally (already done by handleThreadProtocol above)
      if (result) { /* thread already stored */ }
    }
  });

  await new Promise(() => {});
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('Ocean Desk — B端坐席工单系统');
    console.log('');
    console.log('命令:');
    console.log('  node scripts/desk.js setup                      初始化 + 注册');
    console.log('  node scripts/desk.js agent add <name> <openid>  添加坐席');
    console.log('  node scripts/desk.js agent list                 坐席名单');
    console.log('  node scripts/desk.js agent toggle <id>          启用/停用坐席');
    console.log('  node scripts/desk.js agent remove <id>          移除坐席');
    console.log('  node scripts/desk.js queue [--agent <id>]       待处理工单');
    console.log('  node scripts/desk.js show <ticket_id>           查看工单详情');
    console.log('  node scripts/desk.js assign <ticket> <agent>    分配/转派');
    console.log('  node scripts/desk.js draft <ticket> <msg>       起草回复');
    console.log('  node scripts/desk.js send <ticket>              发送回复');
    console.log('  node scripts/desk.js resolve <ticket>           关闭工单');
    console.log('  node scripts/desk.js reopen <ticket>            重开工单');
    console.log('  node scripts/desk.js template list              模板列表');
    console.log('  node scripts/desk.js template use <id> <ticket> 套用模板');
    console.log('  node scripts/desk.js template add <label> <text> 添加模板');
    console.log('  node scripts/desk.js stats                      统计数据');
    console.log('  node scripts/desk.js listen                     实时监听');
    console.log('');
    console.log('数据存储在: ' + DATA_DIR);
    return;
  }

  try {
    switch (cmd) {
      case 'setup':
        await cmdSetup();
        break;
      case 'agent':
        await cmdAgent(args[1], args[2], args[3]);
        break;
      case 'queue': {
        // Parse --agent flag
        let agentId = null;
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--agent' && i + 1 < args.length) { agentId = args[++i]; }
        }
        cmdQueue(agentId);
        break;
      }
      case 'show':
        cmdShow(args[1]);
        break;
      case 'assign':
        cmdAssign(args[1], args[2]);
        break;
      case 'draft':
        cmdDraft(args[1], args.slice(2).join(' '));
        break;
      case 'send':
        await cmdSend(args[1]);
        break;
      case 'resolve':
        await cmdResolve(args[1]);
        break;
      case 'reopen':
        await cmdReopen(args[1]);
        break;
      case 'template':
        cmdTemplate(args[1], args[2], args[3]);
        break;
      case 'stats':
        cmdStats();
        break;
      case 'listen':
        await cmdListen();
        break;
      default:
        console.log('未知命令: ' + cmd);
        console.log('运行 "node scripts/desk.js help" 查看帮助。');
    }
  } catch (err) {
    console.error('错误: ' + err.message);
    process.exit(1);
  }
}

main().catch(err => { console.error('Fatal: ' + err.message); process.exit(1); });
