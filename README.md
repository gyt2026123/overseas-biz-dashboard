# MAPTEC 海外业务合规看板（原型）

数据在腾讯文档智能表格里维护，网页只读一份 `data.json` 做可视化。点页面右上角「同步」即重拉最新 `data.json`。

## 目录结构
```
index.html              前端页面（地图 + 看板 + 明细 + 密码门 + 同步）
data.json               网页实际读取的数据（由 CSV 转换生成）
data.csv                CSV 模板（表头即你要从腾讯表导出的字段）
assets/
  countries-50m.json    合规世界底图（Natural Earth，本地矢量，不依赖境外瓦片）
  echarts.min.js       ECharts（本地）
  topojson-client.min.js TopoJSON 转换（本地）
tools/
  csv_to_json.py       把腾讯表导出的 CSV 转成 data.json
```

## 你以后怎么更新数据（不依赖任何人）
1. 在腾讯文档智能表格里把数据**导出为 CSV**（字段：国家/地区、业务状态、负责人、更新时间、备注）。
   - 国家/地区填**英文国名**，要和底图一致（如 `Singapore`、`Malaysia`、`United States of America`）。
   - 业务状态四选一：`已合规上线` / `合规洽谈中` / `规划评估中` / `暂未进入`。
2. 把 CSV 命名为 `data.csv` 放到工程根目录，覆盖旧的。
3. 运行：`python3 tools/csv_to_json.py` → 生成新的 `data.json`（脚本会提示哪些国名没匹配到底图）。
4. 部署目录重新发布（或你本地起服务），打开网页点「同步」即可看到更新。

> 没出现在 CSV 里的国家，网页一律按「暂未进入」显示。

## 改访问密码
`index.html` 顶部 `const PASSCODE = "maptec2026";` 改成你自己的。
（这是前端软门禁，挡外人用，不是真安全；要真鉴权需加后端。）

## 配色（四态）
- 已合规上线：绿 `#16a34a`
- 合规洽谈中：蓝 `#2563eb`
- 规划评估中：琥珀 `#f59e0b`
- 暂未进入：灰 `#d8dde6`

## 地图合规说明
底图用 Natural Earth 世界矢量数据（本地渲染，不引境外瓦片源，符合合规红线）。
如需在**正式对外发布**时严格对齐中国国家测绘标准（含南海诸岛九段线表示），
建议把底图换成腾讯地图 GL JS（白名单合规源），用你自己的腾讯位置服务 Key；
届时可沿用本页同样的数据结构与四态逻辑，仅需替换地图渲染层。

## 后续升级：点一下「真·实时」
当前是「手动导出 → 网页直连」。要做到你改完腾讯表、页面自动刷新：
- 个人版：在 `docs.qq.com/open` 注册个人开发者应用，走 OAuth 拿到 `refresh_token`，
  用 GitHub Action（或 CloudStudio 定时任务）定时跑 `csv_to_json.py` 的接口版，自动落 `data.json`。
- 企业版（需管理员权限建自建应用）：走企业微信 wedoc 接口，同样定时同步。
- 想要「点一下毫秒级」：在 CloudStudio 跑一个持有凭证的 serverless，同步按钮直调它。
