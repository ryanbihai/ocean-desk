'use strict';

// Ocean Desk Ticket Manager — ticket CRUD and queue logic
// Each ticket wraps a thread_id (1:1 mapping) and adds queue state,
// assignment, SLA tracking, and desk-internal drafts.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = path.join(os.homedir(), '.oceanbus-desk');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTickets() {
  if (!fs.existsSync(TICKETS_FILE)) return { tickets: {} };
  try { return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf-8')); } catch (_) { return { tickets: {} }; }
}

function saveTickets(data) {
  ensureDir();
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2));
}

// ── ID generation ────────────────────────────────────────────────────────────

function generateTicketId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `tk_${date}_${rand}`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function createTicket(threadId, subject, payload) {
  const data = loadTickets();
  const tid = generateTicketId();
  const now = new Date().toISOString();

  const src = payload || {};
  const priority = src.priority === 'urgent' ? 'urgent' : 'normal';

  data.tickets[tid] = {
    ticket_id: tid,
    thread_id: threadId,
    source_skill: src.source_skill || '',
    customer_name: src.customer_name || src.customer_profile?.name || '',
    subject: subject,
    status: 'pending',
    priority,
    assigned_agent: null,
    assigned_at: null,
    created_at: now,
    updated_at: now,
    sla_deadline: null,
    context: {
      customer_profile: src.customer_profile || {},
      ai_summary: src.ai_summary || '',
      recommended_actions: src.recommended_actions || [],
      conversation_log: src.conversation_log || [],
    },
    draft: '',
    replies: [],
  };

  saveTickets(data);
  return tid;
}

function getTicket(ticketId) {
  const data = loadTickets();
  // Support prefix matching
  if (data.tickets[ticketId]) return data.tickets[ticketId];
  const match = Object.values(data.tickets).find(t => t.ticket_id.startsWith(ticketId));
  return match || null;
}

function listTickets(status, agentId) {
  const data = loadTickets();
  let all = Object.values(data.tickets);
  if (status) all = all.filter(t => t.status === status);
  if (agentId) all = all.filter(t => t.assigned_agent === agentId);
  return all;
}

function updateTicket(ticketId, patch) {
  const data = loadTickets();
  const keys = Object.keys(data.tickets);
  const key = keys.find(k => k.startsWith(ticketId));
  if (!key) return false;
  const t = data.tickets[key];
  Object.assign(t, patch);
  t.updated_at = new Date().toISOString();
  saveTickets(data);
  return true;
}

// ── Actions ───────────────────────────────────────────────────────────────────

function assignTicket(ticketId, agentId) {
  const data = loadTickets();
  const key = Object.keys(data.tickets).find(k => k.startsWith(ticketId));
  if (!key) return false;
  const t = data.tickets[key];
  const now = new Date().toISOString();
  t.assigned_agent = agentId;
  t.assigned_at = now;

  // Set SLA deadline based on priority
  if (t.sla_deadline === null) {
    const hours = t.priority === 'urgent' ? 2 : 24;
    t.sla_deadline = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  // Move from pending to active
  if (t.status === 'pending') t.status = 'active';

  t.updated_at = now;
  saveTickets(data);
  return true;
}

function resolveTicket(ticketId) {
  return updateTicket(ticketId, { status: 'resolved' });
}

function reopenTicket(ticketId) {
  const data = loadTickets();
  const key = Object.keys(data.tickets).find(k => k.startsWith(ticketId));
  if (!key) return false;
  if (data.tickets[key].status !== 'resolved') return false;
  return updateTicket(key, { status: 'active' });
}

function addDraft(ticketId, message) {
  return updateTicket(ticketId, { draft: message });
}

function addReply(ticketId, message, direction) {
  const data = loadTickets();
  const key = Object.keys(data.tickets).find(k => k.startsWith(ticketId));
  if (!key) return false;
  data.tickets[key].replies.push({
    direction: direction || 'sent',
    content: message,
    timestamp: new Date().toISOString(),
  });
  // Clear draft after sending
  data.tickets[key].draft = '';
  data.tickets[key].updated_at = new Date().toISOString();
  saveTickets(data);
  return true;
}

// ── Queue ─────────────────────────────────────────────────────────────────────

function getQueue(agentId) {
  const all = listTickets();
  const pending = all.filter(t => t.status === 'pending' || t.status === 'active');
  if (agentId) return pending.filter(t => t.assigned_agent === agentId);

  // Sort: urgent first, then by created_at within same priority
  pending.sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (b.priority === 'urgent' && a.priority !== 'urgent') return 1;
    return new Date(a.created_at) - new Date(b.created_at);
  });
  return pending;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  const all = Object.values(loadTickets().tickets);
  const today = new Date().toISOString().slice(0, 10);
  const todayTickets = all.filter(t => t.created_at.startsWith(today));
  const resolvedToday = all.filter(t => t.status === 'resolved' && t.updated_at.startsWith(today));
  const pending = all.filter(t => t.status === 'pending');
  const active = all.filter(t => t.status === 'active');
  const breached = all.filter(t => t.sla_deadline && new Date(t.sla_deadline) < new Date() && t.status !== 'resolved');

  return {
    today_total: todayTickets.length,
    today_resolved: resolvedToday.length,
    pending: pending.length,
    active: active.length,
    resolved_total: all.filter(t => t.status === 'resolved').length,
    sla_breached: breached.length,
  };
}

module.exports = {
  createTicket, getTicket, listTickets, updateTicket,
  assignTicket, resolveTicket, reopenTicket,
  addDraft, addReply,
  getQueue, getStats,
};
