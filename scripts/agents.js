'use strict';

// Ocean Desk Agent Roster — human agent management
// Stores agent roster in ~/.oceanbus-desk/config.json

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.oceanbus-desk');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { desk_name: '', assign_strategy: 'round-robin', agents: [], desk_openid: '' };
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (_) { return { desk_name: '', assign_strategy: 'round-robin', agents: [], desk_openid: '' }; }
}

function saveConfig(cfg) {
  ensureDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function generateAgentId() {
  const cfg = loadConfig();
  const maxId = cfg.agents.reduce((max, a) => {
    const n = parseInt((a.id || 'agent_00').split('_')[1], 10);
    return n > max ? n : max;
  }, 0);
  return 'agent_' + String(maxId + 1).padStart(2, '0');
}

// ── Agent CRUD ────────────────────────────────────────────────────────────────

function addAgent(name, openid, skills) {
  if (!name || !openid) return { ok: false, msg: 'name 和 openid 必填' };
  const cfg = loadConfig();
  if (cfg.agents.some(a => a.openid === openid)) {
    return { ok: false, msg: '该 OpenID 已存在' };
  }
  const agent = {
    id: generateAgentId(),
    name,
    openid,
    skills: skills || [],
    active: true,
  };
  cfg.agents.push(agent);
  saveConfig(cfg);
  return { ok: true, agent };
}

function removeAgent(agentId) {
  const cfg = loadConfig();
  const idx = cfg.agents.findIndex(a => a.id === agentId);
  if (idx === -1) return false;
  cfg.agents.splice(idx, 1);
  saveConfig(cfg);
  return true;
}

function toggleAgent(agentId) {
  const cfg = loadConfig();
  const agent = cfg.agents.find(a => a.id === agentId);
  if (!agent) return null;
  agent.active = !agent.active;
  saveConfig(cfg);
  return agent;
}

function listAgents() {
  return loadConfig().agents;
}

function findAgent(idOrName) {
  const cfg = loadConfig();
  return cfg.agents.find(a => a.id === idOrName || a.name === idOrName) || null;
}

// ── Assignment ───────────────────────────────────────────────────────────────

function getNextAgent(skill) {
  const cfg = loadConfig();
  const active = cfg.agents.filter(a => a.active);
  if (active.length === 0) return null;

  // Filter by skill if specified; fall back to all active if no match
  let eligible = active;
  if (skill) {
    const matched = active.filter(a => a.skills.some(s =>
      s === skill || skill.includes(s) || s.includes(skill)
    ));
    if (matched.length > 0) eligible = matched;
    // If no skill match, fall back to all active (don't block assignment)
  }

  // Round-robin: find the agent after the last assigned one
  const lastAssigned = cfg._last_assigned || '';
  const lastIdx = eligible.findIndex(a => a.id === lastAssigned);
  const nextIdx = (lastIdx + 1) % eligible.length;
  const agent = eligible[nextIdx];

  // Persist last assigned
  cfg._last_assigned = agent.id;
  saveConfig(cfg);
  return agent;
}

// ── Desk setup ────────────────────────────────────────────────────────────────

function setDeskOpenid(openid) {
  const cfg = loadConfig();
  cfg.desk_openid = openid;
  saveConfig(cfg);
}

function setDeskName(name) {
  const cfg = loadConfig();
  cfg.desk_name = name;
  saveConfig(cfg);
}

function getConfig() {
  return loadConfig();
}

module.exports = {
  loadConfig, saveConfig, getConfig,
  addAgent, removeAgent, toggleAgent, listAgents, findAgent,
  getNextAgent,
  setDeskOpenid, setDeskName,
};
