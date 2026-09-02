#!/usr/bin/env node
/**
 * sync.js — 腾讯文档智能表 → 前端 data.json 自动同步
 *
 * 读取个人版腾讯文档智能表（通过本地/CI 中的 mcporter + tencent-docs MCP 服务），
 * 把记录的字段映射成前端要的四态结构，输出 data.json。
 *
 * 依赖：
 *   - 环境变量 TDOC_FILE_ID / TDOC_SHEET_ID（智能表与工作表 ID）
 *   - 本机或 CI 中已安装 mcporter，并注册好 tencent-docs 服务（带 Authorization Token）
 *   - assets/countries-50m.json（用于全量国家兜底着色）
 *
 * 设计要点：
 *   - 用 smartsheet.list_fields 拿全部列标题（动态，不硬编码）
 *   - 用 smartsheet.list_records 带 field_titles 翻页读取全部记录值
 *   - 列名支持中英文（国家/地区、业务状态、负责人、更新时间、备注）
 *   - 业务状态做模糊归一化到四态：已合规上线 / 合规洽谈中 / 规划评估中 / 暂未进入
 *   - 表无业务列或记录为空时，自动输出全量「暂未进入」默认数据，保证页面不崩
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MCP = process.env.MCPORTER_BIN || 'mcporter';
const FILE_ID = process.env.TDOC_FILE_ID || 'DVG5LUGt4U1FOcVhx';
const SHEET_ID = process.env.TDOC_SHEET_ID || 't00i2h';
const OUT = process.env.TDOC_OUT || path.join(__dirname, 'data.json');

const VALID_STATUS = ['已合规上线', '合规洽谈中', '规划评估中', '暂未进入'];

// ── 调用 mcporter（不进 shell，直接传参，避免转义问题）────────────────────
function mcpCall(tool, args) {
  const r = spawnSync(MCP, ['call', 'tencent-docs', tool, '--args', JSON.stringify(args)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) throw new Error(`调用 mcporter 失败: ${r.error.message}`);
  const out = (r.stdout || '').trim();
  if (!out) throw new Error(`mcporter 返回为空 (${tool})，stderr: ${(r.stderr || '').slice(0, 300)}`);
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`解析 mcporter 输出失败: ${e.message}\n原始输出: ${out.slice(0, 300)}`);
  }
}

// ── 从 oneof 值字段里取出纯文本 ────────────────────────────────────────────
function itemsText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v.items)) return v.items.map((i) => (i.text !== undefined ? i.text : i.name || '')).join('');
  if (v.items && typeof v.items === 'string') return v.items;
  return '';
}
function extractOneof(fv) {
  if (!fv || typeof fv !== 'object') return '';
  if (fv.text_value) return itemsText(fv.text_value);
  if (fv.string_value !== undefined && fv.string_value !== null) return String(fv.string_value);
  if (fv.number_value !== undefined && fv.number_value !== null) return String(fv.number_value);
  if (fv.option_value) return itemsText(fv.option_value);
  if (fv.date_value !== undefined && fv.date_value !== null) return String(fv.date_value);
  if (fv.bool_value !== undefined && fv.bool_value !== null) return fv.bool_value ? '是' : '否';
  // 兜底：扫描任意 *_value 字段
  for (const k of Object.keys(fv)) {
    if (k.endsWith('_value') && fv[k]) return typeof fv[k] === 'object' ? JSON.stringify(fv[k]) : String(fv[k]);
  }
  return '';
}

// ── 业务状态模糊归一化 ────────────────────────────────────────────────────
function normStatus(s) {
  if (!s) return '暂未进入';
  if (VALID_STATUS.includes(s)) return s;
  if (s.includes('上线') || s.includes('运营') || s.includes('已合规')) return '已合规上线';
  if (s.includes('洽谈') || s.includes('接洽') || s.includes('谈判')) return '合规洽谈中';
  if (s.includes('规划') || s.includes('评估') || s.includes('储备')) return '规划评估中';
  return '暂未进入';
}

// ── 单条记录 → 标准字段 ────────────────────────────────────────────────────
function recordToObj(rec) {
  const titleMap = {};
  (rec.field_values || []).forEach((fv) => {
    const t = fv.field || fv.field_title || fv.name;
    if (t) titleMap[t] = extractOneof(fv);
  });
  const get = (...keys) => {
    for (const k of keys) {
      const v = titleMap[k];
      if (v !== undefined && v !== null && v !== '') return String(v).trim();
    }
    return '';
  };
  const name = get('国家/地区', '国家', 'name', 'Name', 'NAME', '国家/地区（中文）');
  const statusRaw = get('业务状态', '状态', 'status', 'Status');
  const owner = get('负责人', 'owner', 'Owner');
  const updated = get('更新时间', '更新日期', 'updated', 'Updated');
  const note = get('备注', 'note', 'Note', 'remark', 'Remark');
  return { name, statusRaw, owner, updated, note };
}

// ── 主流程 ────────────────────────────────────────────────────────────────
function main() {
  console.log(`[sync] 读取智能表 file_id=${FILE_ID} sheet_id=${SHEET_ID}`);

  // 1) 列定义（动态拿全部列标题，用作 list_records 的 field_titles）
  const fieldRes = mcpCall('smartsheet.list_fields', { file_id: FILE_ID, sheet_id: SHEET_ID });
  const fields = fieldRes.fields || [];
  const allTitles = fields.map((f) => f.field_title).filter(Boolean);
  console.log(`[sync] 列定义 ${fields.length} 个:`, allTitles.join(' / '));

  // 2) 翻页读全部记录（带 field_titles 才会返回值）
  const all = [];
  let hasMore = true;
  let next = 0;
  const limit = 100;
  while (hasMore) {
    const args = { file_id: FILE_ID, sheet_id: SHEET_ID, limit, field_titles: allTitles };
    if (next) args.next = next;
    const res = mcpCall('smartsheet.list_records', args);
    (res.records || []).forEach((r) => all.push(r));
    hasMore = !!res.has_more;
    next = res.next || 0;
  }
  console.log(`[sync] 读取记录 ${all.length} 条`);

  // 3) 记录 -> 标准字段
  const byName = {};
  let dumped = false;
  all.forEach((rec) => {
    const o = recordToObj(rec);
    if (!o.name) {
      if (!dumped) {
        dumped = true;
        console.log('[sync][提示] 存在无国家名的记录，已跳过。原始 field_values 样例:');
        console.log('       ', JSON.stringify(rec.field_values).slice(0, 400));
        console.log('[sync][提示] 请确认智能表列名为：国家/地区、业务状态、负责人、更新时间、备注');
      }
      return;
    }
    byName[o.name] = { name: o.name, status: normStatus(o.statusRaw), owner: o.owner, updated: o.updated || '-', note: o.note };
  });
  console.log(`[sync] 有效国家记录 ${Object.keys(byName).length} 条`);

  // 4) 全量国家兜底（读底图）
  const topoPath = path.join(__dirname, 'assets', 'countries-50m.json');
  let allNames = [];
  if (fs.existsSync(topoPath)) {
    const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
    allNames = topo.objects.countries.geometries.map((g) => g.properties && g.properties.name).filter(Boolean);
  } else {
    console.log('[sync][警告] 未找到底图 assets/countries-50m.json，仅输出表中国家');
  }
  allNames = Array.from(new Set(allNames)).sort();

  const result = allNames.map((n) =>
    byName[n] ? byName[n] : { name: n, status: '暂未进入', owner: '', updated: '-', note: '' }
  );

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
  console.log(`[sync] 已写出 ${result.length} 条到 ${OUT}`);
}

try {
  main();
} catch (e) {
  console.error('[sync][错误]', e.message);
  process.exit(1);
}
