/* 页面交互：读写 localStorage、渲染统计与表格、导出文件 */
(function () {
  'use strict';

  var core = window.TokenCore;
  var STORE_KEY = 'token-tracker.records.v1';
  var DAYS_KEY = 'token-tracker.days.v1';
  var SYNC_KEY = 'token-tracker.sync.v1';
  var DEFAULT_SPACE = 'https://langhua1998-douyin-proxy.hf.space';
  var state = { days: 7, records: [], chart: null };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var box = el.toast;
    box.textContent = msg;
    box.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { box.hidden = true; }, 2600);
  }

  /* ---------- 存储 ---------- */

  function loadRecords() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (err) {
      toast('浏览器禁用了本地存储，数据无法保存');
      state.records = [];
      return;
    }
    state.records = core.parseStore(raw);
    if (raw && raw !== '' && state.records.length === 0) {
      toast('本地数据无法解析，已按空数据启动（原数据未删除）');
    }
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.records));
      return true;
    } catch (err) {
      toast('保存失败：浏览器存储空间不足或被禁用');
      return false;
    }
  }

  /* ---------- 渲染 ---------- */

  function filtered() {
    return core.filterByDays(state.records, state.days);
  }

  function renderStats() {
    var agg = core.aggregate(filtered());
    el.statPrompt.textContent = core.formatNumber(agg.promptTokens);
    el.statCompletion.textContent = core.formatNumber(agg.completionTokens);
    el.statTotal.textContent = core.formatNumber(agg.totalTokens);
    el.statCost.textContent = core.formatCost(agg.cost);
    el.statCount.textContent = '共 ' + agg.count + ' 条记录' +
      (state.days === 'all' ? '（全部时间）' : '（近 ' + state.days + ' 天）');
  }

  function renderTable() {
    var rows = filtered().slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 200);
    var body = el.tableBody;
    body.textContent = '';

    el.emptyHint.hidden = rows.length > 0;

    rows.forEach(function (r) {
      var tr = document.createElement('tr');

      var tdTime = document.createElement('td');
      tdTime.className = 'time';
      tdTime.textContent = core.dayKey(r.ts) + ' ' + new Date(r.ts).toTimeString().slice(0, 5);
      tr.appendChild(tdTime);

      var tdModel = document.createElement('td');
      tdModel.textContent = core.isKnownModel(r.model) ? core.MODELS[r.model].label : r.model;
      tr.appendChild(tdModel);

      [r.promptTokens, r.completionTokens, r.totalTokens].forEach(function (n) {
        var td = document.createElement('td');
        td.className = 'num';
        td.textContent = core.formatNumber(n);
        tr.appendChild(td);
      });

      var tdCost = document.createElement('td');
      tdCost.className = 'num';
      tdCost.textContent = core.formatCost(r.cost);
      tr.appendChild(tdCost);

      var tdDel = document.createElement('td');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'del';
      btn.textContent = '删除';
      btn.setAttribute('aria-label', '删除这条记录');
      btn.addEventListener('click', function () {
        if (!confirm('删除这条记录？')) return;
        state.records = state.records.filter(function (x) { return x.id !== r.id; });
        if (saveRecords()) {
          renderAll();
          toast('已删除');
        }
      });
      tdDel.appendChild(btn);
      tr.appendChild(tdDel);

      body.appendChild(tr);
    });
  }

  function renderChart() {
    var fallback = el.chartFallback;
    if (typeof window.Chart === 'undefined') {
      fallback.hidden = false;
      return;
    }
    fallback.hidden = true;

    var series = core.dailySeries(filtered(), state.days);
    var labels = series.map(function (d) { return d.date.slice(5); });
    var values = series.map(function (d) { return d.totalTokens; });

    if (state.chart) {
      state.chart.data.labels = labels;
      state.chart.data.datasets[0].data = values;
      state.chart.update();
      return;
    }

    state.chart = new window.Chart(el.chart, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: '每日 tokens',
          data: values,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74, 222, 128, 0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 2,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return core.formatNumber(ctx.parsed.y) + ' tokens'; }
            }
          }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#93a0bb', maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#93a0bb', callback: function (v) { return core.formatNumber(v); } } }
        }
      }
    });
  }

  function renderAll() {
    renderStats();
    renderTable();
    renderChart();
  }

  /* ---------- 添加记录 ---------- */

  function currentCostPreview() {
    var model = el.fModel.value;
    var p = Number(el.fPrompt.value) || 0;
    var c = Number(el.fCompletion.value) || 0;
    var cost = core.calcCost(model, p, c);
    el.formPreview.textContent = '费用估算：' + core.formatCost(cost.total) +
      '（输入 ' + core.formatCost(cost.input) + ' + 输出 ' + core.formatCost(cost.output) + '）';
  }

  function submitRecord(e) {
    e.preventDefault();
    var input = {
      model: el.fModel.value,
      promptTokens: el.fPrompt.value,
      completionTokens: el.fCompletion.value
    };
    var result = core.createRecord(input);
    if (!result.ok) {
      el.formError.textContent = result.errors.join('；');
      el.formError.hidden = false;
      return;
    }
    el.formError.hidden = true;

    state.records.push(result.record);
    if (!saveRecords()) return;

    el.fPrompt.value = '';
    el.fCompletion.value = '';
    currentCostPreview();
    renderAll();
    toast('已保存：' + core.formatNumber(result.record.totalTokens) + ' tokens，' + core.formatCost(result.record.cost));
  }

  /* ---------- 估算 ---------- */

  function runEstimate(e) {
    if (e) e.preventDefault();
    var model = el.eModel.value;
    var pRaw = String(el.ePrompt.value).trim();
    var cRaw = String(el.eCompletion.value).trim();
    if (pRaw === '' && cRaw === '') {
      el.estimateOut.textContent = '填入 tokens 数量后自动计算';
      return;
    }
    var p = pRaw === '' ? 0 : core.toTokens(pRaw);
    var c = cRaw === '' ? 0 : core.toTokens(cRaw);
    if (!Number.isFinite(p) || p < 0 || !Number.isFinite(c) || c < 0) {
      el.estimateOut.textContent = '请输入不小于 0 的整数 tokens';
      return;
    }
    var cost = core.calcCost(model, p, c);
    el.estimateOut.innerHTML = '输入 ' + core.formatCost(cost.input) +
      ' + 输出 ' + core.formatCost(cost.output) + ' = <strong>' + core.formatCost(cost.total) + '</strong>';
  }

  /* ---------- 导出 ---------- */

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function today() {
    return core.dayKey(new Date()).replace(/-/g, '');
  }

  function exportCSV() {
    var rows = filtered();
    if (rows.length === 0) { toast('当前范围内没有记录'); return; }
    download('token-records-' + today() + '.csv', core.toCSV(rows), 'text/csv;charset=utf-8');
  }

  /* 用浏览器打印代替生成 PDF：中文字体不需要额外嵌入，另存为 PDF 即可 */
  function exportPDF() {
    var rows = filtered().slice().sort(function (a, b) { return b.ts - a.ts; });
    if (rows.length === 0) { toast('当前范围内没有记录'); return; }
    var agg = core.aggregate(rows);

    var win = window.open('', '_blank');
    if (!win) { toast('浏览器拦截了弹出窗口，请允许后重试'); return; }

    var esc = function (s) {
      return String(s).replace(/[&<>"]/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
      });
    };

    var tableRows = rows.slice(0, 500).map(function (r) {
      return '<tr><td>' + esc(core.dayKey(r.ts) + ' ' + new Date(r.ts).toTimeString().slice(0, 8)) + '</td>' +
        '<td>' + esc(core.isKnownModel(r.model) ? core.MODELS[r.model].label : r.model) + '</td>' +
        '<td class="n">' + esc(core.formatNumber(r.promptTokens)) + '</td>' +
        '<td class="n">' + esc(core.formatNumber(r.completionTokens)) + '</td>' +
        '<td class="n">' + esc(core.formatNumber(r.totalTokens)) + '</td>' +
        '<td class="n">' + esc(core.formatCost(r.cost)) + '</td></tr>';
    }).join('');

    win.document.write('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>Token 消耗报表</title><style>' +
      'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;color:#111}' +
      'h1{font-size:20px;margin:0 0 4px}p.meta{color:#666;font-size:12px;margin:0 0 16px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px}' +
      'th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}' +
      'th{background:#f4f4f4}.n{text-align:right}tbody tr:nth-child(even){background:#fafafa}' +
      '.sum{margin:0 0 16px;font-size:13px}.sum b{font-size:15px}' +
      '</style></head><body>' +
      '<h1>Token 消耗报表</h1>' +
      '<p class="meta">生成时间 ' + esc(core.dayKey(new Date()) + ' ' + new Date().toTimeString().slice(0, 8)) +
      ' · 范围 ' + (state.days === 'all' ? '全部时间' : '近 ' + state.days + ' 天') +
      ' · 共 ' + agg.count + ' 条</p>' +
      '<p class="sum">输入 <b>' + esc(core.formatNumber(agg.promptTokens)) + '</b> tokens · ' +
      '输出 <b>' + esc(core.formatNumber(agg.completionTokens)) + '</b> tokens · ' +
      '合计 <b>' + esc(core.formatNumber(agg.totalTokens)) + '</b> tokens · ' +
      '费用 <b>' + esc(core.formatCost(agg.cost)) + '</b></p>' +
      '<table><thead><tr><th>时间</th><th>模型</th><th class="n">输入</th><th class="n">输出</th><th class="n">合计</th><th class="n">费用</th></tr></thead>' +
      '<tbody>' + tableRows + '</tbody></table>' +
      '<p class="meta">' + (rows.length > 500 ? '仅显示最近 500 条，完整数据请导出 CSV。' : '') + '</p>' +
      '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 300);
  }

  function exportJSON() {
    if (state.records.length === 0) { toast('没有数据可备份'); return; }
    download('token-records-backup-' + today() + '.json', JSON.stringify(state.records, null, 2), 'application/json');
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var incoming = core.parseStore(String(reader.result));
      if (incoming.length === 0) { toast('文件里没有可用的记录'); return; }
      var added = core.mergeRecords(state.records, incoming);
      if (saveRecords()) {
        renderAll();
        toast('导入 ' + added + ' 条（重复的已跳过）');
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* ---------- 同步 Space 上记下的用量 ---------- */

  function loadSync() {
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') || {}; } catch (err) { cfg = {}; }
    el.syncUrl.value = cfg.url || DEFAULT_SPACE;
    el.syncKey.value = cfg.key || '';
  }

  function saveSync() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify({ url: el.syncUrl.value.trim(), key: el.syncKey.value.trim() }));
    } catch (err) { /* 忽略 */ }
  }

  function syncStatus(msg) {
    el.syncStatus.textContent = msg;
  }

  function syncNow(quiet) {
    var base = el.syncUrl.value.trim().replace(/\/+$/, '');
    var key = el.syncKey.value.trim();
    if (!base || !key) {
      if (!quiet) toast('先填 Space 地址和读取密钥');
      syncStatus('填好 Space 地址和读取密钥后就能同步');
      return;
    }
    saveSync();
    el.syncNow.disabled = true;
    syncStatus('同步中…（Space 休眠时第一次要等它醒来，可能要一两分钟）');
    fetch(base + '/mac/usage', { headers: { Authorization: 'Bearer ' + key }, cache: 'no-store' })
      .then(function (res) {
        if (res.status === 401) throw new Error('密钥不对');
        if (!res.ok) throw new Error('Space 返回 ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var incoming = core.fromUsage(data && data.records);
        var added = core.mergeRecords(state.records, incoming);
        if (added > 0 && !saveRecords()) return;
        renderAll();
        var msg = '已同步：Space 上共 ' + incoming.length + ' 条，新增 ' + added + ' 条（' +
          core.dayKey(new Date()) + ' ' + new Date().toTimeString().slice(0, 5) + '）';
        syncStatus(msg);
        if (!quiet || added > 0) toast(msg);
      })
      .catch(function (err) {
        var why = err && err.message ? err.message : String(err);
        if (why === 'Failed to fetch' || why.indexOf('NetworkError') >= 0 || why.indexOf('Load failed') >= 0) {
          why = '连不上 Space（地址不对、Space 在休眠或还没部署带 /mac/usage 的版本）';
        }
        syncStatus('同步失败：' + why);
        if (!quiet) toast('同步失败：' + why);
      })
      .then(function () { el.syncNow.disabled = false; });
  }

  /* ---------- 初始化 ---------- */

  function fillModelSelect(select) {
    core.listModels().forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label + '（¥' + m.input + ' / ¥' + m.output + ' 每百万）';
      select.appendChild(opt);
    });
  }

  function restoreRange() {
    var saved = null;
    try { saved = localStorage.getItem(DAYS_KEY); } catch (err) { saved = null; }
    if (!saved) return;
    var buttons = el.range.querySelectorAll('button[data-days]');
    var match = null;
    Array.prototype.forEach.call(buttons, function (b) {
      if (b.getAttribute('data-days') === saved) match = b;
    });
    if (!match) return;
    Array.prototype.forEach.call(buttons, function (b) { b.classList.toggle('active', b === match); });
    state.days = saved === 'all' ? 'all' : Number(saved);
  }

  function bind() {
    el.range.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-days]');
      if (!btn) return;
      Array.prototype.forEach.call(el.range.querySelectorAll('button'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      var days = btn.getAttribute('data-days');
      state.days = days === 'all' ? 'all' : Number(days);
      try { localStorage.setItem(DAYS_KEY, String(days)); } catch (err) { /* 忽略 */ }
      renderAll();
    });

    el.recordForm.addEventListener('submit', submitRecord);
    el.fPrompt.addEventListener('input', currentCostPreview);
    el.fCompletion.addEventListener('input', currentCostPreview);
    el.fModel.addEventListener('change', currentCostPreview);

    el.estimateForm.addEventListener('submit', runEstimate);
    [el.ePrompt, el.eCompletion, el.eModel].forEach(function (node) {
      node.addEventListener('input', function () { runEstimate(); });
      node.addEventListener('change', function () { runEstimate(); });
    });

    el.syncNow.addEventListener('click', function () { syncNow(false); });
    el.syncForm.addEventListener('submit', function (e) { e.preventDefault(); syncNow(false); });
    el.syncUrl.addEventListener('change', saveSync);
    el.syncKey.addEventListener('change', saveSync);

    el.exportCsv.addEventListener('click', exportCSV);
    el.exportPdf.addEventListener('click', exportPDF);
    el.exportJson.addEventListener('click', exportJSON);
    el.importJson.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) importJSON(file);
      e.target.value = '';
    });
    el.clearAll.addEventListener('click', function () {
      if (state.records.length === 0) { toast('本来就是空的'); return; }
      if (!confirm('确定清空全部 ' + state.records.length + ' 条记录？建议先备份 JSON。')) return;
      state.records = [];
      if (saveRecords()) { renderAll(); toast('已清空'); }
    });
  }

  function init() {
    el = {
      statPrompt: $('stat-prompt'),
      statCompletion: $('stat-completion'),
      statTotal: $('stat-total'),
      statCost: $('stat-cost'),
      statCount: $('stat-count'),
      chart: $('chart'),
      chartFallback: $('chart-fallback'),
      range: $('range'),
      recordForm: $('record-form'),
      fModel: $('f-model'),
      fPrompt: $('f-prompt'),
      fCompletion: $('f-completion'),
      formPreview: $('form-preview'),
      formError: $('form-error'),
      estimateForm: $('estimate-form'),
      eModel: $('e-model'),
      ePrompt: $('e-prompt'),
      eCompletion: $('e-completion'),
      estimateOut: $('estimate-out'),
      tableBody: $('table-body'),
      emptyHint: $('empty-hint'),
      exportCsv: $('export-csv'),
      exportPdf: $('export-pdf'),
      exportJson: $('export-json'),
      importJson: $('import-json'),
      clearAll: $('clear-all'),
      toast: $('toast'),
      syncForm: $('sync-form'),
      syncUrl: $('sync-url'),
      syncKey: $('sync-key'),
      syncNow: $('sync-now'),
      syncStatus: $('sync-status')
    };

    fillModelSelect(el.fModel);
    fillModelSelect(el.eModel);

    loadRecords();
    restoreRange();
    bind();
    currentCostPreview();
    runEstimate();
    renderAll();
    loadSync();
    if (el.syncKey.value) syncNow(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
