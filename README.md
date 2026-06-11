# LazyPerson A 股走势分析工具

个人 A 股走势分析便捷工具，目标是把实时行情、分钟线、历史日线、技术指标、资金流和自选股看板整合到一个本地优先的轻量系统里。

> 免责声明：本项目仅用于个人学习、数据整理和辅助研究，不构成任何投资建议。第三方数据源的可用性、频率限制、字段含义和授权边界应以其官方说明为准。

## 当前阶段

本仓库当前先落地实现方案和步骤文档，后续按 MVP -> 增强分析 -> 策略实验的节奏推进。

## 推荐组合

- 数据源：实时行情和分钟线优先使用 `efinance` / 东方财富数据；历史日线、补充数据和基础资料使用 `AKShare`，必要时用 `BaoStock` 做补齐和交叉校验。
- 后端：Python + FastAPI，负责数据适配、缓存、指标计算、API 聚合。
- 缓存：本地 SQLite 存元数据、自选股、任务状态；Parquet 存 K 线、分钟线、资金流等时序数据。
- 前端：React + Vite，K 线优先使用 TradingView `lightweight-charts`，看板和资金流可用 ECharts。
- 指标：MA、EMA、MACD、RSI、成交量均线、涨跌幅、换手率、资金净流入等。

## 文档入口

- [总体实现方案](docs/ARCHITECTURE.md)
- [落地步骤](docs/IMPLEMENTATION_STEPS.md)
- [数据源与缓存策略](docs/DATA_AND_CACHE.md)
- [前后端接口草案](docs/API_CONTRACT.md)
- [MVP 验收清单](docs/MVP_ACCEPTANCE.md)
- [V2 升级方案](docs/V2_UPGRADE_PLAN.md)
- [V3 自动画线方案](docs/V3_AUTO_DRAWING_PLAN.md)
- [V3.1 自动画线调整方案](docs/V3_1_AUTO_DRAWING_ADJUSTMENT.md)
- [项目更新记录](docs/UPDATES.md)
- [文档落地规则](docs/DOCUMENTATION_POLICY.md)

## 本地启动

```powershell
python -m pip install -r requirements.txt
npm install
npm --prefix frontend install
npm run dev
```

启动后访问：

- 前端：http://127.0.0.1:5175
- 后端健康检查：http://127.0.0.1:8008/api/health

## 验证

```powershell
npm run test
npm run build
```

## 目录结构

```text
backend/          FastAPI 后端、数据源适配、缓存、指标
frontend/         React + Vite 前端
data/cache/       本地运行时缓存，默认不需要手动创建
docs/             实现方案和阶段文档
tests/            后端单元测试
```

## 外部资料

- [AKShare 在线文档](https://akshare.akfamily.xyz/)
- [efinance 文档](https://efinance.readthedocs.io/)
- [efinance GitHub](https://github.com/Micro-sheep/efinance)
- [BaoStock Python API 文档](https://baostock.com/baostock/index.php/Python_API%E6%96%87%E6%A1%A3)
