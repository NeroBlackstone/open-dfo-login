# dfo-login

一个基于 [Bun](https://bun.com) 的 CLI 工具，用于管理 DFO 私服账号：配置数据库、注册账号、登录并获取游戏客户端登录 token。

## 快速开始（无需安装）

如果你已经安装了 [Bun](https://bun.com)，可以直接运行最新发布版本，无需 clone 或 `bun install`：

```bash
bunx dfo-login --help                # 显示帮助
bunx dfo-login init                  # 配置数据库连接 + 粘贴 RSA 私钥
bunx dfo-login signup                # 注册新账号
bunx dfo-login login                 # 登录，打印游戏 token，缓存到本地
bunx dfo-login lookup                # 列出所有已缓存的账号名
bunx dfo-login lookup <name>         # 打印指定账号的缓存 token
bunx dfo-login list-character <name> # 列出指定账号的所有角色
bunx dfo-login list-backup           # 列出所有备份
bunx dfo-login backup <account> <character> # 备份角色到 JSON 文件
bunx dfo-login restore <account> <file>     # 从备份恢复到指定账号
bunx dfo-login recharge-cera <name> <amount>       # 为账号充值 CERA（点券）
bunx dfo-login recharge-cera-point <name> <amount> # 为账号充值 CERA POINT（代币券）
bunx dfo-login mail [character]     # 向角色发送游戏内邮件（物品）
bunx dfo-login complete-quest <character> --quest <id>...  # 完成指定任务
bunx dfo-login complete-quest <character> --all            # 完成所有进行中的任务
```

指定版本运行：

```bash
bunx dfo-login@0.1.0 login
```

首次运行会在 `~/.dfo-login/` 下创建配置文件、私钥和 token 缓存。

## 环境要求

- [Bun](https://bun.com) >= 1.3
- 已部署的 MySQL 实例，包含 `d_taiwan`、`taiwan_login`、`taiwan_billing`、`taiwan_cain_2nd` 和 `taiwan_cain` schema（本工具不会创建它们）
- 与游戏服务器匹配的 RSA 私钥（PEM 格式）

## 数据库结构

本工具读写 DFO 私服 MySQL 布局中的一小部分。五个相关 schema 分别存储账号表、登录状态、计费、角色数据和角色信息桥接表。它们的关系如下：

```
d_taiwan.accounts (uid)                ── m_id ──┐
   │                                            │
   ├─ d_taiwan.member_info                     │
   ├─ d_taiwan.limit_create_character          │  账号级别
   ├─ d_taiwan.member_join_info                │  （每个账号
   ├─ d_taiwan.member_miles                    │   一行）
   ├─ d_taiwan.member_white_account            │
   ├─ taiwan_login.member_login                │
   ├─ taiwan_billing.cash_cera ─── account ────┤
   ├─ taiwan_billing.cash_cera_point ── account ┤
   └─ taiwan_cain_2nd.member_avatar_coin ──────┘
                                                │
                                                ▼
                              taiwan_cain.charac_info (m_id → uid)
                                                │ charac_no
                                                ▼
                              角色级别表
                              taiwan_cain / taiwan_cain_2nd
                              (inventory, user_items, skill, ...)
```

### 账号级别表（由 `signup` 写入）

每个新账号会在十张表中各插入一行，均以 `m_id`（或等价字段）作为外键关联 `d_taiwan.accounts.uid`。

| 表名 | 主键 | 关联字段 | 用途 |
| --- | --- | --- | --- |
| `d_taiwan.accounts` | `uid` | `uid` | 登录凭证：`accountname`、MD5 `password`、`qq`、`dzuid`、`billing`、`VIP` |
| `d_taiwan.limit_create_character` | `m_id` | `m_id` | 每账号角色创建配额 / 最后访问时间 |
| `d_taiwan.member_info` | `m_id` | `m_id` | 会员资料（`user_id`、`passwd`、`email`、密保问题等） |
| `d_taiwan.member_join_info` | `m_id` | `m_id` | 注册 IP、国家代码、最后登录时间 |
| `d_taiwan.member_miles` | `m_id` | `m_id` | 会员积分 |
| `d_taiwan.member_white_account` | `m_id` | `m_id` | 白名单标记 |
| `taiwan_login.member_login` | `m_id` | `m_id` | 登录状态：`login_time`、`expire_time`、`security_flag`、`dungeon_gain_gold`、`garena_token_key` 等 |
| `taiwan_billing.cash_cera` | `account` | `account` (varchar(30) = uid) | CERA（点券）余额 |
| `taiwan_billing.cash_cera_point` | `account` | `account` | CERA POINT（代币券）余额 |
| `taiwan_cain_2nd.member_avatar_coin` | `m_id` | `m_id` | 头像硬币余额 |

### 角色桥接表

`list-character` 和备份命令通过一张核心表实现账号到角色的路由：

| 表名 | 主键 | 外键 | 说明 |
| --- | --- | --- | --- |
| `taiwan_cain.charac_info` | `charac_no` | `m_id` → `d_taiwan.accounts.uid` | 53 列角色主记录：`charac_name`（UNIQUE）、`village`、`job`、`lev`、`exp`、属性、`guild_id`、`VIP`、`create_time`、`last_play_time`、`delete_flag` |

### `charac_view` — 角色选择界面

`charac_view` 是账号级别的表，游戏服务器读取它来渲染角色选择界面。每行以 `m_id`（账号 uid）为键。关键列是 `info` — 一个 zlib 压缩的二进制 blob，编码该账号下所有角色的信息。

#### `info` 缓冲区布局

```
[0-3]   uint32LE   解压后数据长度（固定为 5328）
[4..]   zlib 压缩的数据
```

解压后的数据为 **5328 字节**，分为 **36 个槽位 × 每槽位 148 字节**。每个槽位代表选择界面中的一个角色位置：

| 偏移 | 大小 | 类型 | 字段 |
| --- | --- | --- | --- |
| 0–3 | 4 | uint32LE | `charac_no`（0 = 空槽位） |
| 4–19 | 16 | bytes | `charac_name`（UTF-8，null 填充） |
| 24–25 | 2 | uint16LE | `job`（0=Slayer, 1=Fighter, …） |
| 26–27 | 2 | uint16LE | `village`（出生村庄 id） |

每个 148 字节槽位的其余部分为填充（零值）— 游戏服务器只读取上述字段。

**重要**：`restore` 命令在插入行后会自动重建 `charac_view`。槽位大小（148）和字段偏移（24、26）是通过逆向工程原版服务器的 `charac_view` 数据确定的。未经实际游戏客户端验证，请勿修改这些值。

#### 其他 `charac_view` 列

| 列名 | 典型值 | 含义 |
| --- | --- | --- |
| `charac_count` | 非删除角色数 | 部分 UI 元素显示用 |
| `slot_effect_count` | 36 | 特效总槽位数 |
| `charac_slot_limit` | 36 | 最大角色槽位数 |
| `hash_key` | `''`（空） | 本实现中未使用 |

### 角色级别表（`list-character` 使用的主要表）

所有表以 `charac_no` 为键（不直接包含 `m_id` — 始终通过 `charac_info` 关联）。`taiwan_cain` 和 `taiwan_cain_2nd` 中共有 50+ 张此类表；`list-character` 只汇总最常用的游戏相关表：

| 表名 | 存储内容 |
| --- | --- |
| `taiwan_cain_2nd.inventory` | 角色背包数据 blob（物品、装备、宠物） |
| `taiwan_cain_2nd.user_items` | 拥有的物品（药剂、装备、材料，含 `jewel_socket` blob） |
| `taiwan_cain_2nd.skill` | 技能树状态（`skill_slot`、`remain_sp` 等） |
| `taiwan_cain_2nd.combo_skill` / `combo_skill_2nd` | 连招技能槽 |
| `taiwan_cain_2nd.fair_pvp_score` | PvP 胜负、排名、任务信息 |
| `taiwan_cain_2nd.charac_inven_expand` | 背包扩展次数 |
| `taiwan_cain.charac_stat` / `charac_option` / `charac_achievement` | 属性、UI 选项、成就 |
| `taiwan_cain.charac_kill_monster_info` / `charac_npc` / `charac_quest_shop` | 任务 / NPC 进度 |
| `taiwan_cain.charac_titlebook` / `charac_dungeon_clear` / `new_charac_quest` / `pvp_result` | 称号、副本记录、任务 |

### 备份（`backup <account> <charac>`）

`backup <account> <charac>` 遍历 `taiwan_cain` + `taiwan_cain_2nd` 中所有包含 `charac_no` 列的表（通过 `information_schema.COLUMNS` 查询），并 SELECT 匹配 `charac_no` 的行。输出为 `~/.dfo-login/backups/<account>_<charac>_<YYYYMMDD-HHMMSS>.json`，包含 `manifest`（元数据）和 `data`（表名 → 行数组）两个部分。BLOB 列（如 `inventory.inventory`、`user_items.jewel_socket`）序列化为 `{ __buf: true, data: "<base64>" }` 格式以确保往返安全。

### 恢复（`restore <target_account> <backup_file>`）

`restore` 是 `backup` 的逆操作。它从 `~/.dfo-login/backups/` 读取 JSON 文件，并将所有行插入数据库的目标账号 `<target_account>` 下 — 该账号可以与原始 `manifest.account_name` 不同（跨账号迁移）。关键行为：

- **新 `charac_no`**：始终分配为整个 `charac_info` 表的 `MAX(charac_no) + 1`。这使得恢复可重复且安全，即使目标账号已有角色；源 `manifest` 中的 `charac_no` **不会**被重用。
- **账号外键重写**：角色级别行上的每个 `m_id` 列都会被重写为目标账号的 `uid`。`charac_info.charac_name` 会被重写为用户选择的最终名称。10 张账号级别表（由 `signup` 写入）**不会**被修改 — 目标账号必须已存在。
- **`charac_name` 唯一性**：`charac_name` 在全局范围内唯一。如果源名称已存在于数据库中，CLI 会交互式提示输入新名称（空输入取消恢复）。
- **BLOB 往返**：`__buf` 信封会被解码回 `Buffer`，再绑定为 BLOB 参数。
- **原子性**：整个恢复过程包裹在一个事务中。如果任何行插入失败，整个恢复回滚，不会写入任何数据。事务开始前会要求确认（`yes`/`no`，默认 `no`）。
- **源端无影响**：源账号、源角色和备份文件都不会被修改。

## 本地安装（开发用）

```bash
git clone <repo> && cd open-dfo-login
bun install
```

## 命令列表

| 命令 | 说明 |
| --- | --- |
| `init` | 交互式配置数据库连接和 RSA 私钥；输出到 `~/.dfo-login/` |
| `signup` | 交互式注册新账号（账号名、密码、QQ、初始 CERA / CERA POINT） |
| `login` | 交互式登录，打印完整游戏 token，追加到 `tokens.json` |
| `lookup [name]` | 查找缓存的 token。无参数时列出所有已缓存的账号名 |
| `list-character <name>` | 列出指定账号的所有角色（含概要：等级、职业、背包物品数量等） |
| `backup <account> <charac>` | 将指定角色的所有角色级别 DB 行导出为 `~/.dfo-login/backups/` 下的 JSON 文件 |
| `restore <target_account> <backup_file>` | 从备份 JSON 恢复到目标账号。分配新的 `charac_no`（max+1）并重写 `m_id`。原子事务 |
| `recharge-cera <name> <amount>` | 为指定账号充值 CERA（点券）。`amount` 必须为正数 |
| `recharge-cera-point <name> <amount>` | 为指定账号充值 CERA POINT（代币券）。`amount` 必须为正数 |
| `mail [character]` | 向角色发送游戏内邮件（物品）。交互式选择物品 |
| `complete-quest <charac> --quest <id>...` | 完成指定任务。支持 `--items` 自动发放任务所需物品（[JSON 格式说明](docs/quest-items.md)） |
| `complete-quest <charac> --all` | 完成所有进行中的任务 |
| `help` | 打印帮助信息 |

## `~/.dfo-login/` 目录结构

```
db_config.json   # 数据库连接配置（host/port/user/password）
private_key.pem  # RSA 私钥，文件权限 0600
tokens.json      # 明文 token 缓存（账号名 -> token）
```

`tokens.json` 是明文 token 缓存 — 请将其视为凭证。

## 安全说明

- 私钥文件以 `0600` 权限写入，仅在登录时读取，不会打印到终端。
- 密码在发送到数据库前进行 MD5 哈希，与服务器存储格式一致。明文密码不会被持久化。
- 游戏 token 会打印到 stdout 并缓存到 `tokens.json`。建议通过 `lookup` 复用缓存的 token，而非重复登录。

## 开发

```bash
bunx tsc --noEmit                   # 类型检查
bunx @biomejs/biome check .         # 格式化 + lint
```

## 许可证

仅供个人学习 DFO 私服协议使用。请在 24 小时内删除。
