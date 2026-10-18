# BSR 滑雪装备租赁与维护管理系统

系统覆盖双门店租赁接待、预约资料复用、适配推荐、合同收费、装备交付、换装与跨店归还、维修协同、安全验收、运营待办和审计追踪。

## 技术结构

- Next.js / React / TypeScript
- Cloudflare D1
- Drizzle 数据模型与迁移

核心业务界面位于 `app/`，数据库定义位于 `db/`，数据库迁移位于 `drizzle/`。

## 本地运行

需要 Node.js 22.13 或更高版本。

```powershell
npm install
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_flippant_yellow_claw.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_real_norrin_radd.sql
npm start
```

启动后访问终端显示的本地地址。数据库首次使用时会写入用于业务流程验证的基础数据。

## 系统边界

系统保存收费请求、处理结果和审计记录，不连接短信、财务核算或生产身份认证服务。
