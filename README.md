# Token 消耗记录

一个纯静态的 Token 消耗记录与费用估算网页。打开就能用，数据只保存在你自己的浏览器里（localStorage），不上传任何服务器。

在线地址：<https://langhua98.github.io/qwen-token/>

## 功能

- **概览**：输入 / 输出 / 合计 tokens 和费用，支持近 7 / 30 / 90 天和全部时间
- **趋势图**：按天统计的 token 折线图（Chart.js）
- **添加记录**：选模型、填输入输出 tokens，自动算出费用并存下
- **费用估算**：不落库，只算给你看
- **导出**：CSV（Excel 可直接打开）、PDF（走浏览器打印，中文字体没问题）、JSON 备份
- **导入**：合并 JSON 备份，重复记录自动跳过
- **删除 / 清空**：单条删除需要确认，清空前建议先备份

## 同步 Mac 本地模型用量

Mac 上 Ollama 跑的 qwen3.5:9b 经 HF Space 的 `/mac/v1` 调用时，Space 会把每次返回的 tokens 记下来（xiaoju-video 仓库 `streamer/mac_link.py`），从 `GET /mac/usage` 读出来。

打开页面就自动同步（Space 地址默认 `https://langhua1998-douyin-proxy.hf.space`，可以在页面上改），也可以点「立即同步」。重复的记录自动跳过，费用按下面的价格算。

只有 Space 部署了带 `/mac/usage` 的版本以后的调用才会被记下来，之前的用量拿不到。

## 价格

价格写在 `js/core.js` 的 `MODELS` 里，单位是 **元 / 百万 tokens**，直接改数值即可：

```js
var MODELS = {
  'qwen3.5:9b': { label: 'Qwen3.5 9B', input: 0.1, output: 0.1 },
  'gpt-4o':     { label: 'GPT-4o',     input: 36,  output: 108 }
};
```

美元计价的模型按 7.2 的汇率折算过，自己按实际汇率调整即可。

## 本地运行

```bash
cd token-tracker
python3 -m http.server 8765
# 打开 http://localhost:8765
```

直接双击 `index.html` 也能用，只是部分浏览器在 `file://` 下会限制 localStorage。

## 测试

```bash
node --test tests/
```

覆盖：费用计算、非法输入拒绝、按天筛选边界、本地时区分日、CSV 转义、损坏数据回退、超小费用显示。

## 部署

推到 `main` 分支后，GitHub Actions 自动跑测试并发布到 GitHub Pages（`.github/workflows/pages.yml`）。

首次需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 为什么没有后端

GitHub Pages 只能托管静态文件，跑不了 Flask。所以统计、聚合、导出全部放在浏览器里做，代价是数据只存在当前浏览器，换设备需要手动导出 JSON 再导入。

## 目录

```
index.html            页面
css/style.css         样式
js/core.js            纯逻辑（价格、费用、聚合、CSV），Node 测试共用
js/app.js             页面交互、存储、导出
tests/core.test.js    单元测试
.github/workflows/    Pages 自动部署
```

## 数据安全提醒

清浏览器缓存、换浏览器、用无痕模式都会让数据消失。重要数据请定期点「备份 JSON」。
