const test = require('node:test');
const assert = require('node:assert');
const core = require('../js/core.js');

const DAY = 86400000;

test('费用计算：百万 tokens 输入输出', () => {
  const c = core.calcCost('qwen3.5:9b', 1000000, 1000000);
  assert.ok(Math.abs(c.total - 0.2) < 1e-9);
  assert.ok(Math.abs(c.input - 0.1) < 1e-9);
  assert.ok(Math.abs(c.output - 0.1) < 1e-9);
});

test('费用计算：未知模型返回 0 而不是 NaN', () => {
  const c = core.calcCost('不存在', 1000, 1000);
  assert.deepStrictEqual(c, { input: 0, output: 0, total: 0 });
});

test('创建记录：正常输入生成完整记录', () => {
  const r = core.createRecord({ model: 'gpt-4o', promptTokens: 1000, completionTokens: 500, now: 1700000000000 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.totalTokens, 1500);
  assert.strictEqual(r.record.promptTokens, 1000);
  assert.ok(r.record.cost > 0);
  assert.ok(typeof r.record.id === 'string' && r.record.id.length > 3);
});

test('创建记录：负数 tokens 被拒绝', () => {
  const r = core.createRecord({ model: 'gpt-4o', promptTokens: -1, completionTokens: 10 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('创建记录：非数字 tokens 被拒绝', () => {
  assert.strictEqual(core.createRecord({ model: 'gpt-4o', promptTokens: 'abc', completionTokens: 1 }).ok, false);
  assert.strictEqual(core.createRecord({ model: 'gpt-4o', promptTokens: '', completionTokens: 1 }).ok, false);
  assert.strictEqual(core.createRecord({ model: 'gpt-4o', promptTokens: null, completionTokens: 1 }).ok, false);
});

test('创建记录：两者都是 0 被拒绝', () => {
  assert.strictEqual(core.createRecord({ model: 'gpt-4o', promptTokens: 0, completionTokens: 0 }).ok, false);
});

test('创建记录：未知模型被拒绝', () => {
  const r = core.createRecord({ model: 'gpt-9', promptTokens: 10, completionTokens: 10 });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors.join(), /未知模型/);
});

test('创建记录：小数 tokens 向下取整', () => {
  const r = core.createRecord({ model: 'gpt-4o', promptTokens: 10.9, completionTokens: 5.2 });
  assert.strictEqual(r.record.promptTokens, 10);
  assert.strictEqual(r.record.completionTokens, 5);
});

test('聚合：空数据返回全 0', () => {
  assert.deepStrictEqual(core.aggregate([]), {
    count: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0
  });
});

test('聚合：多条记录求和', () => {
  const records = [
    { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.5 },
    { promptTokens: 20, completionTokens: 10, totalTokens: 30, cost: 1.5 }
  ];
  const a = core.aggregate(records);
  assert.strictEqual(a.count, 2);
  assert.strictEqual(a.totalTokens, 45);
  assert.strictEqual(a.cost, 2);
});

test('按天数筛选：7 天含今天共 7 个自然日', () => {
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const records = [
    { ts: now, totalTokens: 1 },
    { ts: now - 6 * DAY, totalTokens: 1 },
    { ts: now - 7 * DAY, totalTokens: 1 }
  ];
  const out = core.filterByDays(records, 7, now);
  assert.strictEqual(out.length, 2);
});

test('按天数筛选：all 返回全部', () => {
  const records = [{ ts: 1 }, { ts: 2 }];
  assert.strictEqual(core.filterByDays(records, 'all', Date.now()).length, 2);
});

test('日聚合：补零并只按本地日期分组', () => {
  const now = new Date(2026, 10, 2, 23, 30, 0).getTime();
  const records = [
    { ts: now, promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: 0.1 },
    { ts: now - DAY, promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.1 }
  ];
  const series = core.dailySeries(records, 7, now);
  assert.strictEqual(series.length, 7);
  assert.strictEqual(series[6].date, '2026-11-02');
  assert.strictEqual(series[6].totalTokens, 15);
  assert.strictEqual(series[5].totalTokens, 2);
  assert.strictEqual(series[0].totalTokens, 0);
});

test('CSV：逗号引号换行被正确转义', () => {
  const csv = core.toCSV([
    { ts: new Date(2026, 0, 1, 8, 0, 0).getTime(), model: '逗号,模型', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0.000001 },
    { ts: new Date(2026, 0, 1, 8, 0, 0).getTime(), model: '引号"模型', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0 },
    { ts: new Date(2026, 0, 1, 8, 0, 0).getTime(), model: '换行\n模型', promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: 0 }
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"逗号,模型"'));
  assert.ok(csv.includes('"引号""模型"'));
  assert.ok(csv.includes('"换行\n模型"'));
  assert.ok(csv.includes('2026-01-01 08:00:00'));
});

test('解析本地存储：损坏数据回退为空数组', () => {
  assert.deepStrictEqual(core.parseStore('{坏掉的 json'), []);
  assert.deepStrictEqual(core.parseStore('null'), []);
  assert.deepStrictEqual(core.parseStore('{"a":1}'), []);
  assert.deepStrictEqual(core.parseStore(''), []);
  assert.deepStrictEqual(core.parseStore(undefined), []);
});

test('解析本地存储：丢掉字段异常的单条记录', () => {
  const raw = JSON.stringify([
    { ts: 1700000000000, model: 'gpt-4o', promptTokens: 10, completionTokens: 5, cost: 0.001 },
    { ts: 'not-a-date', model: 'gpt-4o', promptTokens: 1, completionTokens: 1 },
    { ts: 1700000000000, model: 'gpt-4o', promptTokens: -5, completionTokens: 1 },
    null
  ]);
  const out = core.parseStore(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].totalTokens, 15);
});

test('格式化：大数字加千分位、极小费用不显示为 0', () => {
  assert.strictEqual(core.formatNumber(1234567), '1,234,567');
  assert.ok(core.formatCost(0.0000015).startsWith('¥0.0000'));
  assert.strictEqual(core.formatCost(0), '¥0.00');
  assert.strictEqual(core.formatNumber(NaN), '0');
});

test('同步：Space 的用量记录补上费用，坏数据丢掉', () => {
  const list = core.fromUsage([
    { id: 'm1', ts: 1700000000000, model: 'qwen3.5:9b', promptTokens: 1000000, completionTokens: 1000000 },
    { id: 'm2', ts: 1700000000001, model: 'other', promptTokens: 10, completionTokens: 5 },
    { id: 'm3', ts: 'bad', model: 'qwen3.5:9b', promptTokens: 1, completionTokens: 1 },
    { id: 'm4', ts: 1700000000002, model: 'qwen3.5:9b', promptTokens: 0, completionTokens: 0 },
    null
  ]);
  assert.deepStrictEqual(list.map((r) => r.id), ['m1', 'm2']);
  assert.ok(Math.abs(list[0].cost - 0.2) < 1e-9);
  assert.strictEqual(list[0].totalTokens, 2000000);
  assert.strictEqual(list[1].cost, 0);
  assert.deepStrictEqual(core.fromUsage(undefined), []);
});

test('同步：合并时 id 重复的跳过', () => {
  const have = [{ id: 'a' }, { id: 'b' }];
  const added = core.mergeRecords(have, [{ id: 'b' }, { id: 'c' }, { id: 'c' }]);
  assert.strictEqual(added, 1);
  assert.deepStrictEqual(have.map((r) => r.id), ['a', 'b', 'c']);
});
