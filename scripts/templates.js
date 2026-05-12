'use strict';

// Ocean Desk Templates — canned response management
// Stores templates in ~/.oceanbus-desk/templates.json

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.oceanbus-desk');
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json');

const DEFAULT_TEMPLATES = [
  {
    id: 'tpl_greeting',
    label: '首次问候',
    text: '您好！我是{agent_name}，很高兴为您服务。关于您的{subject}，我来帮您处理。',
    category: '通用',
  },
  {
    id: 'tpl_booking_confirm',
    label: '预约确认',
    text: '已为您确认预约：{details}。如有变更请随时联系我。',
    category: '预约',
  },
  {
    id: 'tpl_followup',
    label: '跟进提醒',
    text: '您好！关于之前的{subject}，想了解一下进展如何？有需要我进一步协助的地方吗？',
    category: '跟进',
  },
  {
    id: 'tpl_transfer',
    label: '转接通知',
    text: '您好，我是{agent_name}，将由我来继续为您处理{subject}的相关事宜。',
    category: '通用',
  },
  {
    id: 'tpl_resolve',
    label: '结单确认',
    text: '您的问题已处理完毕。如有其他需要，随时联系我们。祝您生活愉快！',
    category: '通用',
  },
];

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadTemplates() {
  ensureDir();
  if (!fs.existsSync(TEMPLATES_FILE)) {
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(DEFAULT_TEMPLATES, null, 2));
    return DEFAULT_TEMPLATES;
  }
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8')); } catch (_) { return DEFAULT_TEMPLATES; }
}

function saveTemplates(templates) {
  ensureDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

function listTemplates(category) {
  const all = loadTemplates();
  if (category) return all.filter(t => t.category === category);
  return all;
}

function getTemplate(id) {
  const all = loadTemplates();
  return all.find(t => t.id === id || t.id.startsWith(id)) || null;
}

function applyTemplate(id, vars) {
  const tpl = getTemplate(id);
  if (!tpl) return null;

  let text = tpl.text;
  for (const [key, value] of Object.entries(vars || {})) {
    text = text.replace(new RegExp('\\{' + key + '\\}', 'g'), value || '');
  }
  return text;
}

function addTemplate(label, text, category) {
  const all = loadTemplates();
  const id = 'tpl_' + label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  all.push({ id, label, text, category: category || '自定义' });
  saveTemplates(all);
  return id;
}

module.exports = {
  listTemplates, getTemplate, applyTemplate, addTemplate,
  loadTemplates, saveTemplates,
};
