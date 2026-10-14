# BSR 滑雪装备租赁管理系统

依据课程需求分析报告从零实现的全栈课程系统。系统覆盖双门店接待、适配推荐、租赁合同、模拟支付、交付、换装、跨店归还、维修协同、安全验收、经理看板和审计追踪。

## 技术结构

- Next.js / React / TypeScript
- Cloudflare D1（SQLite 兼容）
- Drizzle 数据模型与迁移
- OpenAI Sites 私有云端部署

核心业务代码位于 `app/`，数据库定义位于 `db/`，初始迁移位于 `drizzle/`。

## 本地运行

需要 Node.js 22.13 或更高版本。

```powershell
npm install
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flippant_yellow_claw.sql
npm start
```

启动后访问终端显示的本地地址。首次访问会自动写入一组演示数据，便于直接验收主要业务流程。

## 演示边界

支付接口采用可审计的模拟交易；短信、财务系统和生产级身份认证属于报告界定的外部系统，因此未接入真实第三方账户。界面中的角色切换用于课堂演示不同岗位功能。

