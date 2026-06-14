# 任务物品 JSON 格式说明

`complete-quest` 命令支持 `--items` 参数，可在完成任务的同时通过游戏内邮件自动发放任务所需物品。本文档说明该 JSON 文件的格式。

## 文件路径

默认参考：`quest-items.json`（项目根目录）

使用时通过 `--items` 指定路径：

```bash
dfo-login complete-quest Dark --quest 2809 --items quest-items.json
```

## JSON 结构

文件顶层是一个**数组**，每个元素代表一个任务的物品需求：

```json
[
  {
    "id": "2809",
    "require": [
      { "item_id": 3220, "count": 150 },
      { "item_id": 3042, "count": 30 }
    ]
  },
  {
    "id": "1019",
    "require": [
      { "item_id": 3227, "count": 4 },
      { "item_id": 3230, "count": 4 }
    ]
  }
]
```

## 字段说明

### 顶层元素（`QuestItemEntry`）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 任务的 `quest_idx`（字符串格式，内部会解析为整数） |
| `require` | `QuestItemRequirement[]` | 是 | 该任务完成时需要发放的物品列表 |

### 物品元素（`QuestItemRequirement`）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `item_id` | `number` | 是 | 物品 ID（对应数据库中的 `item_id`） |
| `count` | `number` | 是 | 发放数量（对应 `postal` 表的 `add_info` 字段） |

## 工作原理

1. 通过 `--items quest-items.json` 加载文件，构建 `quest_idx → 物品列表` 的映射
2. 完成每个任务时，查找该 `quest_idx` 是否有对应的物品需求
3. 如果有，向 `taiwan_cain_2nd.letter` 插入一封发件人为 `GM`、标题为"任务奖励"的邮件
4. 向 `taiwan_cain_2nd.postal` 插入每种物品的记录，物品会出现在角色的游戏邮箱中

## 注意事项

- `id` 字段是字符串类型（`"2809"`），不是数字，但内容必须是合法整数
- 同一个 `id` 在数组中只应出现一次；重复的会被后者覆盖
- `item_id` 为 `0` 时会插入一条无效记录，通常用于特殊用途（如金币发放）
- 物品发放与任务完成在同一个事务中执行，任一失败则整体回滚
- 物品通过邮件发放，需要角色上线后在邮箱中查收
