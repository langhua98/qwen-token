/* 纯逻辑模块：浏览器和 Node 测试共用，不碰 DOM */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TokenCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* 价格单位：元 / 百万 tokens。改这里就能调整价格。 */
  var MODELS = {
    'qwen3.5:9b': { label: 'Qwen3.5 9B', input: 0.1, output: 0.1 },
    'qwen-plus': { label: 'Qwen Plus', input: 0.8, output: 2 },
    'deepseek-chat': { label: 'DeepSeek Chat', input: 1.44, output: 2.16 },
    'gpt-4o-mini': { label: 'GPT-4o mini', input: 1.08, output: 4.32 },
    'gpt-4o': { label: 'GPT-4o', input: 36, output: 108 },
    'claude-3.5-sonnet': { label: 'Claude 3.5 Sonnet', input: 21.6, output: 108 }
  };

  var PRICE_UNIT = 1000000;
  var CURRENCY = '¥';
  var DAY_MS = 86400000;

  function listModels() {
    return Object.keys(MODELS).map(function (id) {
      return { id: id, label: MODELS[id].label, input: MODELS[id].input, output: MODELS[id].output };
    });
  }

  function isKnownModel(model) {
    return Object.prototype.hasOwnProperty.call(MODELS, model);
  }

  /* 空值、小数、科学计数法都要能判断，非法返回 NaN */
  function toTokens(value) {
    if (value === '' || value === null || value === undefined) return NaN;
    if (typeof value === 'boolean') return NaN;
    var n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.trunc(n);
  }

  function validateInput(input) {
    var errors = [];
    var model = input && input.model;
    if (!isKnownModel(model)) errors.push('未知模型：' + model);

    var prompt = toTokens(input && input.promptTokens);
    var completion = toTokens(input && input.completionTokens);

    if (!Number.isFinite(prompt) || prompt < 0) errors.push('输入 tokens 必须是不小于 0 的整数');
    if (!Number.isFinite(completion) || completion < 0) errors.push('输出 tokens 必须是不小于 0 的整数');
    if (Number.isFinite(prompt) && Number.isFinite(completion) && prompt + completion === 0) {
      errors.push('输入和输出 tokens 不能同时为 0');
    }

    return { ok: errors.length === 0, errors: errors, promptTokens: prompt, completionTokens: completion };
  }

  function calcCost(model, promptTokens, completionTokens) {
    var price = MODELS[model];
    if (!price) return { input: 0, output: 0, total: 0 };
    var p = Number(promptTokens) || 0;
    var c = Number(completionTokens) || 0;
    var inputCost = (p / PRICE_UNIT) * price.input;
    var outputCost = (c / PRICE_UNIT) * price.output;
    return { input: inputCost, output: outputCost, total: inputCost + outputCost };
  }

  function createRecord(input) {
    var check = validateInput(input);
    if (!check.ok) return { ok: false, errors: check.errors };

    var ts = input && input.now !== undefined ? new Date(input.now).getTime() : Date.now();
    if (!Number.isFinite(ts)) return { ok: false, errors: ['时间无效'] };

    var cost = calcCost(input.model, check.promptTokens, check.completionTokens);
    return {
      ok: true,
      record: {
        id: 'r' + ts.toString(36) + Math.random().toString(36).slice(2, 8),
        ts: ts,
        model: input.model,
        promptTokens: check.promptTokens,
        completionTokens: check.completionTokens,
        totalTokens: check.promptTokens + check.completionTokens,
        cost: cost.total
      }
    };
  }

  /* 读取旧数据时用，任何字段异常就丢掉这条，避免脏数据污染统计 */
  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ts = Number(raw.ts);
    if (!Number.isFinite(ts) || ts <= 0) return null;
    var p = toTokens(raw.promptTokens);
    var c = toTokens(raw.completionTokens);
    if (!Number.isFinite(p) || p < 0) return null;
    if (!Number.isFinite(c) || c < 0) return null;
    var cost = Number(raw.cost);
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : 'r' + ts.toString(36),
      ts: ts,
      model: isKnownModel(raw.model) ? raw.model : String(raw.model || '未知模型'),
      promptTokens: p,
      completionTokens: c,
      totalTokens: p + c,
      cost: Number.isFinite(cost) && cost >= 0 ? cost : 0
    };
  }

  function normalizeRecords(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normalizeRecord).filter(function (r) { return r !== null; });
  }

  function parseStore(raw) {
    if (raw === null || raw === undefined || raw === '') return [];
    try {
      return normalizeRecords(JSON.parse(raw));
    } catch (err) {
      return [];
    }
  }

  function aggregate(records) {
    var out = { count: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
    (records || []).forEach(function (r) {
      out.count += 1;
      out.promptTokens += r.promptTokens;
      out.completionTokens += r.completionTokens;
      out.totalTokens += r.totalTokens;
      out.cost += r.cost;
    });
    return out;
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* 用本地时区切日，避免 UTC 偏移导致跨天错位 */
  function dayKey(value) {
    var d = value instanceof Date ? value : new Date(value);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function startOfDay(value) {
    var d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /* days 为 0 或 'all' 表示不筛选 */
  function filterByDays(records, days, now) {
    var list = records || [];
    var n = days === 'all' ? 0 : Number(days);
    if (!Number.isFinite(n) || n <= 0) return list.slice();
    var end = startOfDay(now === undefined ? Date.now() : now);
    var start = new Date(end.getTime() - (n - 1) * DAY_MS);
    var from = start.getTime();
    return list.filter(function (r) {
      return r.ts >= from && r.ts <= end.getTime() + DAY_MS - 1;
    });
  }

  function dailySeries(records, days, now) {
    var n = days === 'all' || Number(days) <= 0 ? 0 : Number(days);
    var end = startOfDay(now === undefined ? Date.now() : now);
    var buckets = {};
    var order = [];

    if (n > 0) {
      for (var i = n - 1; i >= 0; i -= 1) {
        var key = dayKey(new Date(end.getTime() - i * DAY_MS));
        buckets[key] = { date: key, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
        order.push(key);
      }
    }

    (records || []).forEach(function (r) {
      var key = dayKey(r.ts);
      if (!buckets[key]) {
        buckets[key] = { date: key, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 };
        order.push(key);
      }
      buckets[key].promptTokens += r.promptTokens;
      buckets[key].completionTokens += r.completionTokens;
      buckets[key].totalTokens += r.totalTokens;
      buckets[key].cost += r.cost;
    });

    order.sort();
    return order.map(function (key) { return buckets[key]; });
  }

  function stamp(ts) {
    var d = new Date(ts);
    return dayKey(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  /* CSV 字段含逗号、引号、换行时必须加引号并把引号翻倍 */
  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(records) {
    var header = ['时间', '模型', '输入tokens', '输出tokens', '总tokens', '费用(元)'];
    var rows = [header.map(csvCell).join(',')];
    (records || []).forEach(function (r) {
      rows.push([
        stamp(r.ts),
        isKnownModel(r.model) ? MODELS[r.model].label : r.model,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.cost.toFixed(6)
      ].map(csvCell).join(','));
    });
    return '\uFEFF' + rows.join('\r\n') + '\r\n';
  }

  function formatNumber(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return Math.round(v).toLocaleString('zh-CN');
  }

  function formatCost(n) {
    var v = Number(n) || 0;
    if (v === 0) return CURRENCY + '0.00';
    if (v < 0.01) return CURRENCY + v.toFixed(4);
    return CURRENCY + v.toFixed(2);
  }

  return {
    MODELS: MODELS,
    PRICE_UNIT: PRICE_UNIT,
    CURRENCY: CURRENCY,
    listModels: listModels,
    isKnownModel: isKnownModel,
    toTokens: toTokens,
    validateInput: validateInput,
    calcCost: calcCost,
    createRecord: createRecord,
    normalizeRecord: normalizeRecord,
    normalizeRecords: normalizeRecords,
    parseStore: parseStore,
    aggregate: aggregate,
    dayKey: dayKey,
    startOfDay: startOfDay,
    filterByDays: filterByDays,
    dailySeries: dailySeries,
    toCSV: toCSV,
    formatNumber: formatNumber,
    formatCost: formatCost
  };
});
