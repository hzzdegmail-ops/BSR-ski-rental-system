# BSR 滑雪装备租赁与维护管理系统

系统分析与设计课程项目，包含两家门店的预约接待、装备推荐、合同收费、换装归还、维修与经营管理。

- [分析设计文档（PDF，46 页）](./BSR滑雪装备租赁与维护管理系统分析设计文档.pdf)
- [可编辑报告源文件](./docs/source/BSR滑雪装备租赁与维护管理系统分析设计文档.tex)
- [在线演示](https://bsrgear.cn/)

报告更新于 2026 年 11 月 25 日，代码为 2026 年 11 月 24 日版本。课程系统使用模拟支付。

## 功能

| 用例 | 功能 | 操作角色 |
| --- | --- | --- |
| UC01 | 接待顾客并推荐装备 | 门店员工 |
| UC02 | 创建合同并收费 | 门店员工 |
| UC03 | 办理换装与归还 | 门店员工 |
| UC04 | 提交维修工单 | 门店员工 |
| UC05 | 更新维修进度、验收及退役确认 | 维修承包商、责任门店员工 |
| UC06 | 查看经营与待办 | 经理 |

预约可提前选装付款，到店后复用原合同核对取件；现场顾客按实际到店顺序排队。付款取件后可试装，不合适时按原合同换装。经理统计以租赁单数、租金金额、装备利用率和排队等待为主。

## 本地运行

安装 Node.js 24 或更新版本，在仓库根目录执行。以下密码设置示例使用 Windows PowerShell：

```powershell
npm ci
$env:DEMO_PASSWORD = "your-local-demo-password"
npm start
```

打开 <http://127.0.0.1:8765/>，选择一店员工、二店员工、维修承包商或经理，输入刚设置的本地密码。账号分别为 `north.staff`、`south.staff`、`repair`、`manager`。

数据库在首次启动时初始化，`BSR_DB_PATH` 可指定本地数据库文件位置。

## 检查

```sh
npm test
```

当前 57 项自动检查覆盖预约、库存与适配、接待队列、收费防重、原合同换装、维修权限、经营统计及持久化等流程。

## 部署

独立服务器可执行 `npm run start:server`，默认端口为 8080。`BSR_DATA_DIR` 指定持久化数据目录，`PUBLIC_ORIGIN` 指定公开访问地址。也可使用 Docker Compose：

```sh
docker compose up -d --build
```

Vercel 构建入口为 `build-vercel.mjs`，部署配置见 `vercel.json`。云端持久化访问凭据在部署平台的环境变量中设置。

## 文件结构

- `client/`：员工、维修承包商及经理工作台。
- `server/`：业务规则、权限、数据访问与统计。
- `api/`：Vercel 入口。
- `drizzle/`：20 张业务表、经营统计视图及迁移。
- `test/`：自动检查。
- `docs/source/`：可编辑报告、图表与编译资源。

报告使用 XeLaTeX，在 `docs/source/` 目录连续编译两次，需要 Microsoft YaHei 和 STZhongsong 字体。图表 PDF 资源可直接用于编译，PlantUML 源文件及 SVG 位于 `diagrams/`。
