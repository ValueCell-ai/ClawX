# 飞书日历 / 电子表格能力的同类产品调研

调研日期：2026-10-19

调研范围：OpenClaw 同类 agent 产品（旧/新官方飞书插件、社区兼容版、openclaw-python、Hermes）、
低代码/工作流平台（Dify、n8n）、工具型 agent（hope-agent）、官方飞书 MCP 与 lark-cli，
以及闭源的 Coze 2.5 / 飞书 aily。重点只看**日历（Calendar）**和**电子表格（Sheets）**，
不把多维表格（Bitable）混为一谈。

## 结论

1. **日历有成熟解法，电子表格才是真正的空白。**
   旧官方插件、Dify、openclaw-python、hope-agent、Lark MCP、lark-cli 都能覆盖日历；
   但真正能完整读写飞书电子表格单元格的，只有旧官方插件的 `feishu_sheet` 和 lark-cli。
   新官方 `@openclaw/feishu@2026.10.5` 两者都没有，只保留 Bitable 工具。

2. **用户身份是分水岭，不只是“缺几个工具”。**
   旧插件的日历/表格工具明确标注【以用户身份】，日历 create 还要求从消息上下文取
   `user_open_id`；新官方插件只有 bot 身份，且移除了 `feishu_oauth` / UAT 能力。
   因此恢复个人日历/个人表格必须补用户 OAuth，不能只包一层 tenant token 的 OpenAPI。

3. **大多数“龙虾类”产品只做通道，不碰生产力域。**
   Hermes 飞书插件、AstrBot、LangBot 等只实现消息/卡片；日历/表格交给 MCP、CLI 或外部工具。
   Dify 是少数把日历、表格拆成独立工具插件的平台型产品。

4. **对 ClawX 最划算的是“官方通道插件 + lark-cli 能力补充包”**，
   而不是把日历/表格重新塞回 `@openclaw/feishu` 或维护旧插件分叉。

## 横向对比

| 产品 / 方案 | 日历 | 电子表格（Sheets） | 身份 | 形态 | 与 OpenClaw 2026.10.5 |
| --- | --- | --- | --- | --- | --- |
| 旧官方 `@larksuite/openclaw-lark@2026.7.16` | ✅ 4 个工具 + `feishu-calendar` skill | ✅ `feishu_sheet`：info/read/write/append/find/create/export | 用户（UAT/OAuth） | 原生 Node 插件 | ❌ 加载失败（SDK 入口已删） |
| 新官方 `@openclaw/feishu@2026.10.5` | ❌ | ❌（只有 Bitable） | bot | 原生 ESM 插件 | ✅ 当前方案 |
| 社区兼容版 `@hotwvpyym/openclaw-lark@2026.10.6` | ✅ 旧代码保留 | ✅ 旧代码保留 | 用户 | 旧插件分叉 | ⚠️ 通道可启动，但 2026.10.5 上 `contracts.tools` 被删，实测 `toolNames=0` |
| `openxjarvis/openclaw-python` | ✅ `feishu_calendar`（list/get/create/update/delete） | ❌（Bitable + 本地 xlsx skill） | bot 主日历 | Python 插件 | 非 OpenClaw 宿主 |
| Hermes `hermes-feishu-plugin` | ❌ | ❌ | — | Python 通道插件 | 仅通道 |
| Dify 官方 `feishu_calendar` | ✅ 7 个工具 | — | tenant token（第三方代理） | 独立工具插件 | 平台插件，非 OpenClaw |
| Dify 官方 `feishu_spreadsheet` | — | ✅ 8 个工具：create/get/list、read/write rows/cols/table | tenant token（第三方代理） | 独立工具插件 | 平台插件 |
| n8n `@tjnhpro/n8n-nodes-lark` | ✅ Calendar 目标 | ❌（Bitable） | tenant/ISV | 工作流节点 | 非 agent 宿主 |
| hope-agent `skills/feishu` | ✅ 6 个 calendar 工具 | ❌（Bitable） | 工具账号 | Skill + tools | 其他 agent 套件 |
| 官方 Lark MCP `@larksuiteoapi/lark-mcp@0.5.1` | ✅ `preset.calendar.default`（5 个） | ⚠️ 27 个 sheets.v3 工具，但**没有单元格值读写** | tenant / user OAuth | MCP stdio/HTTP | 可直接接 OpenClaw `mcp.servers` |
| 官方 lark-cli `@larksuite/cli` | ✅ `+agenda/+create/+freebusy/+suggestion/+rsvp/...` | ✅ `+workbook-create/+cells-get/+cells-set/+table-put/+csv-get/put/...` | user / bot | Go CLI + skills | 可作为能力补充包 |
| Coze 2.5 / 飞书 aily（闭源） | ✅ | 公开演示主要是文档/多维表/日程，未看到完整 Sheets | 用户授权 | 原生闭源集成 | 不可复用 |

## 各方案是怎么做的

### 1. 旧官方 openclaw-lark：原生工具 + 用户身份

- 日历拆成 4 个工具：`feishu_calendar_calendar`、`feishu_calendar_event`、
  `feishu_calendar_event_attendee`、`feishu_calendar_freebusy`。
- `feishu_calendar_event` 的 create 必须传 `user_open_id`（消息 SenderId），
  否则日程只落在应用日历上，用户看不到；工具内部用 `{ as: 'user' }` 调 SDK。
- 电子表格是一个 action 型工具 `feishu_sheet`：
  `info` / `read` / `write` / `append` / `find` / `create` / `export`，
  支持传 URL 或 `spreadsheet_token`，自动解析 wiki URL。
- 依赖旧 `openclaw/plugin-sdk` 和 CJS 构建，2026.10.5 已无法加载。
- **可复用价值**：工具语义、动作拆分、用户身份参数设计，仍是目前最完整的参考。

### 2. 新官方 @openclaw/feishu：channel-first，主动收缩

- 14 个工具：doc / drive / perm / wiki / chat / app_scopes / bitable。
- 没有 calendar、没有 sheets，也没有用户 OAuth。
- 它的定位是“消息通道 + 文档协作”，不是“飞书全量工作台”。
- 因此不应指望上游把日历/表格补回来；能力补充应做成独立插件/技能。

### 3. 社区兼容版：旧代码 + 新版本适配

- 保留旧插件的 9 个 skills、37 个工具、footer 指标和 41 字段配置。
- 但 2026.10.6 为了过 ClawHub 扫描删掉了 manifest `contracts.tools`，
  在 OpenClaw 2026.10.5 上会报 `plugin must declare contracts.tools before registering agent tools`，
  实测通道能启动、`toolNames` 为 0。
- 要用它必须补回 `contracts.tools`，并接受第三方维护/供应链风险；不建议作为默认方案。

### 4. openclaw-python：单工具 + 动作枚举

- 一个 `feishu_calendar` 工具，`action` 枚举 list/get/create/update/delete，
  默认 `calendar_id=primary`，解析 bot 主日历。
- 没有飞书 Sheets 工具；表格能力是 Bitable + 本地 `.xlsx` skill。
- 说明“单工具 + 多 action”可以降低工具数量，但对 Sheets 这种复杂域仍不够。

### 5. Dify：按域拆成独立插件

- `feishu_calendar`：7 个工具，app_id/app_secret，tenant token。
  工具包括 list/search/create/update/delete event、attendees、primary calendar。
- `feishu_spreadsheet`：8 个工具，按行/列/表读写：
  create_spreadsheet、get_spreadsheet、list_spreadsheet_sheets、
  read_rows/read_cols/read_table、add_rows/add_cols。
- 代码里统一走 `https://lark-plugin-api.solutionsuite.cn/lark-plugin` 代理，
  不是直连 `open.feishu.cn`；这是第三方托管代理，企业数据/可用性需要评估。
- 只有 tenant token，没有用户 OAuth；适合“应用可见资源”，不适合个人主日历/个人表格。
- **可借鉴**：日历、表格、Bitable、文档各自独立插件，故障域小、权限清晰。

### 6. n8n / hope-agent：工作流/工具套件

- n8n Lark 节点目标 API 是 Messaging、Bitable、Approval、Calendar，没有 Sheets。
- hope-agent 的 `skills/feishu` 暴露 35 个 `feishu_*` 工具，日历 6 个，表格仍是 Bitable。
- 这两类产品证明：**日历是常见需求，Sheets 不是**；很多产品用 Bitable 替代了表格场景。

### 7. 官方 Lark MCP：日历够用，表格不够

- 近 1,400 个 OpenAPI 工具，支持 stdio/HTTP、tenant token 和 user OAuth（`lark-mcp login`）。
- 日历有 `preset.calendar.default`（5 个常用工具），可直接接 OpenClaw 的 `mcp.servers`。
- Sheets 有 27 个 `sheets.v3.*` 工具，但**没有 `spreadsheetSheetValue.*` 单元格值读写**；
  只有 create/get/patch、sheet 查询、filter/filter view、float image、find/replace 等。
  也就是说它能建表、查元数据、做筛选/替换，但不能完整“读某区域的值/写某区域的值”。
- 工具总量太大，接入时必须用 preset 或 `toolFilter.include` 收窄，否则 token 成本很高。

### 8. 官方 lark-cli：目前唯一“全量且可用户身份”的现成能力

- 日历：`+agenda`、`+create`、`+freebusy`、`+get`、`+meeting`、`+room-find`、`+rsvp`、
  `+search-event`、`+suggestion`、`+update`，以及 raw `calendars/events/freebusys`。
- 表格：`+workbook-create`、`+cells-get`、`+cells-set`、`+cells-search`、`+cells-clear`、
  `+table-put`、`+csv-get/put`、`+batch-update`、`+history-*`、图表/条件格式等。
- 身份：`--as user` / `--as bot`；本地实测 user 身份已带
  `calendar:calendar.*`、`sheets:spreadsheet.*`、`task:*`、`im:*` 等 scope。
- 体积：单平台约 42MB（npm 包安装时下载二进制），三平台约 126MB。
- 自带 `lark-cli skills`，可直接读出 `lark-calendar`、`lark-sheets` 等 SKILL.md。
- 这是最接近“旧插件能力”的现成方案，而且不依赖 OpenClaw 插件 SDK。

### 9. 闭源 Coze / 飞书 aily

- Coze 2.5 接入飞书后可演示日程、文档、多维表等操作；飞书 aily/智能伙伴是原生集成。
- 公开资料只有产品文档/演示，没有可复用的插件实现；其优势是原生用户授权和内部 API。
- 可借鉴的是“用户授权 + 原生工具”的产品体验，而不是代码。

## 为什么电子表格最难

1. **身份**：个人表格默认只有用户 token 能读写；bot 只能看被显式共享/应用创建的表格。
2. **数据模型**：spreadsheet_token → sheet_id → A1 range，涉及值/公式/样式/合并单元格/类型，
   比日历的 event 对象复杂得多。
3. **Bitable 混淆**：Bitable 是“结构化记录”，CRUD 语义清晰，很多产品只做 Bitable，
   对外却容易被理解成“支持表格”。
4. **工具设计**：一个 action 工具很难覆盖全部 Sheets API；拆成 20+ 工具又会推高 token。
5. **输出体积**：读大区域需要分页/文件 offload/字符上限，CLI 的 `--max-chars`、CSV 模式
   就是为 agent 场景做的工程化处理。

## 对 ClawX 的建议

### 方案 A（推荐）：官方通道插件 + lark-cli 能力补充包

- 保留 `@openclaw/feishu` 负责消息通道。
- 新增一个很小的 `clawx-lark-tools` 插件，注册 `lark_calendar` / `lark_sheets` 两个
  typed tool（内部 `execFile` 调 lark-cli，不走 shell），并打包
  `lark-calendar`、`lark-sheets`、`lark-shared` 三个 skill。
- 授权：复用 `lark-cli config init` + 设备码/浏览器 OAuth，支持 `--as user` / `--as bot`；
  在设置页显示身份、scope、过期时间。
- 安全：命令白名单只允许 `calendar`、`sheets`（后续再开 `base`/`task`/`im`）；
  限制 `--max-chars`、输出落文件、按 agent 配置权限。
- 成本：2–4 天 MVP；每平台约 42MB 二进制。
- 收益：日历 + 表格全量能力，且未来可直接扩到 task/base/im/mail。

### 方案 B（最快）：Lark MCP 补日历，lark-cli 补表格

- `mcp.servers.lark` 配 `preset.calendar.default`，用 `lark-mcp login` 做用户 OAuth。
- 表格仍走 lark-cli（MCP 当前没有单元格值读写）。
- 成本：0.5–1 天（如果 ClawX 已有 MCP 设置界面）；否则还要补 MCP UI。
- 适合先快速恢复日历，再迭代表格。

### 方案 C：原生 micro-plugin 移植旧插件 calendar/sheet 模块

- 直接复用旧插件的工具语义和用户 OAuth 流程，但要重新适配 2026.10 插件 SDK。
- 成本 1–2 周，后续还要跟 OpenClaw SDK 演进；不如 CLI 稳。

### 方案 D：换社区兼容版

- 需要补回 `contracts.tools`，且依赖第三方维护；不建议作为默认方案。

## 参考

- 旧官方插件：<https://github.com/larksuite/openclaw-lark>
- 新官方插件：<https://www.npmjs.com/package/@openclaw/feishu>
- 社区兼容版：<https://github.com/hotwvpyym/openclaw-lark-compat>
- openclaw-python：<https://github.com/openxjarvis/openclaw-python>
- Hermes 飞书插件：<https://github.com/hellowind777/hermes-feishu-plugin>
- Dify 日历插件：<https://github.com/langgenius/dify-official-plugins/tree/main/tools/feishu_calendar>
- Dify 表格插件：<https://github.com/langgenius/dify-official-plugins/tree/main/tools/feishu_spreadsheet>
- Lark MCP：<https://github.com/larksuite/lark-openapi-mcp>
- Lark MCP 工具列表：<https://github.com/larksuite/lark-openapi-mcp/blob/main/docs/tools-en.md>
- lark-cli：<https://github.com/larksuite/cli>
- hope-agent 飞书 skill：<https://github.com/shiwenwen/hope-agent/blob/main/skills/feishu/SKILL.md>
- n8n Lark 节点：<https://www.npmjs.com/package/@tjnhpro/n8n-nodes-lark>
- Coze 飞书使用文档：<https://docs.coze.cn/cozespace_using-coze-in-feishu.md>
- 飞书 aily：<https://aily.feishu.cn/hc/1u7kleqg/2t3efrzi>
