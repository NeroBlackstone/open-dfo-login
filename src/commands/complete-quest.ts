import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { getCurrentDbConfig } from "../db-config.ts";
import { confirmYesNo } from "../prompts.ts";

interface QuestItemRequirement {
	item_id: number;
	count: number;
}

interface QuestItemEntry {
	id: string;
	require: QuestItemRequirement[];
}

/**
 * dfo-login complete-quest <角色名> --quest <id>...:
 * 自动完成指定角色的指定任务。
 *
 * 实现原理:
 *   new_charac_quest 表中 play_1~play_20 存放当前活跃任务的 quest_idx,
 *   play_{slot}_trigger 表示任务状态: 1=进行中, 0=已完成。
 *   完成任务就是把对应槽位的 trigger 设为 0。
 */
export async function completeQuestCommand(args: string[]): Promise<void> {
	// --help 支持
	if (args.includes("--help") || args.includes("-h")) {
		console.log("用法: dfo-login complete-quest <角色名> --quest <id>...");
		console.log("       dfo-login complete-quest <角色名> --all");
		console.log("");
		console.log("自动完成指定角色的指定任务。");
		console.log("");
		console.log("参数:");
		console.log("  <角色名>        目标角色 (全局唯一)");
		console.log(
			"  --quest <id>    要完成的 quest_idx (可多次使用,与 --all 二选一)",
		);
		console.log("  --all           完成所有进行中的任务");
		console.log(
			"  --items <path>  任务物品 JSON 文件路径 (可选,同时发放任务所需物品)",
		);
		console.log("  --help, -h      显示此帮助信息");
		console.log("");
		console.log("示例:");
		console.log("  dfo-login complete-quest Dark --quest 106 --quest 4470");
		console.log("  dfo-login complete-quest Dark --all");
		console.log(
			"  dfo-login complete-quest Dark --quest 2809 --items quest-items.json",
		);
		return;
	}

	console.log("=== 自动完成任务 (complete-quest) ===");

	// 解析参数
	const flags = parseArgs(args);
	const characName = flags._[0]?.trim();

	if (!characName) {
		console.error("✗ 用法: dfo-login complete-quest <角色名> --quest <id>...");
		process.exit(1);
	}

	if (!flags.all && flags.quest.length === 0) {
		console.error("✗ 必须指定 --quest <id> 或 --all");
		process.exit(1);
	}

	if (flags.all && flags.quest.length > 0) {
		console.error("✗ --all 和 --quest 不能同时使用");
		process.exit(1);
	}

	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(getCurrentDbConfig());

		// 直接按角色名查找
		const characRow = await fetchCharacInfoByName(connection, characName);
		if (!characRow) {
			console.error(`✗ 未找到角色 "${characName}"。`);
			process.exit(1);
		}

		const characNo = characRow.charac_no as number;
		console.log(`角色: ${characName} (charac_no=${characNo})`);

		// 加载任务物品 JSON
		const questItemMap: Map<number, QuestItemRequirement[]> = new Map();
		if (flags.items) {
			try {
				const jsonContent = await readFile(flags.items, "utf-8");
				const questItems: QuestItemEntry[] = JSON.parse(jsonContent);
				for (const entry of questItems) {
					const questId = Number.parseInt(entry.id, 10);
					if (Number.isInteger(questId) && entry.require) {
						questItemMap.set(questId, entry.require);
					}
				}
				console.log(`已加载任务物品数据: ${questItemMap.size} 个任务`);
			} catch (error) {
				console.error(`✗ 无法读取任务物品文件: ${flags.items}`);
				console.error(error);
				process.exit(1);
			}
		}

		// 读取当前任务槽位
		const slots = await readQuestSlots(connection, characNo);
		if (!slots) {
			console.error("✗ 未找到 new_charac_quest 记录。");
			process.exit(1);
		}

		// 显示当前活跃任务
		console.log("\n当前活跃任务:");
		const activeQuests: { slot: number; questIdx: number; trigger: number }[] =
			[];
		for (let i = 1; i <= 20; i++) {
			const questIdx = slots[`play_${i}`] as number;
			const trigger = slots[`play_${i}_trigger`] as number;
			if (questIdx && questIdx !== 0) {
				console.log(`  槽位 ${i}: quest_idx=${questIdx}, trigger=${trigger}`);
				activeQuests.push({ slot: i, questIdx, trigger });
			}
		}
		if (activeQuests.length === 0) {
			console.log("  (无)");
		}

		// 查找目标任务所在的槽位
		const toComplete: { slot: number; questIdx: number }[] = [];

		if (flags.all) {
			console.log("\n目标: 所有进行中的任务");
			for (const q of activeQuests) {
				if (q.trigger !== 0) {
					console.log(
						`  quest ${q.questIdx}: 待完成 (槽位 ${q.slot}, trigger=${q.trigger})`,
					);
					toComplete.push({ slot: q.slot, questIdx: q.questIdx });
				}
			}
		} else {
			const targetQuests = flags.quest;
			console.log(`\n目标任务: ${targetQuests.join(", ")}`);

			for (const questIdx of targetQuests) {
				const found = activeQuests.find((a) => a.questIdx === questIdx);
				if (found) {
					if (found.trigger === 0) {
						console.log(
							`  quest ${questIdx}: 已完成 (槽位 ${found.slot}, trigger=0)`,
						);
					} else {
						console.log(
							`  quest ${questIdx}: 待完成 (槽位 ${found.slot}, trigger=${found.trigger})`,
						);
						toComplete.push({ slot: found.slot, questIdx });
					}
				} else {
					console.log(`  quest ${questIdx}: 未在活跃槽位中找到`);
				}
			}
		}

		if (toComplete.length === 0) {
			console.log("\n✓ 所有目标任务已完成或不在活跃槽位中,无需修改。");
			return;
		}

		// 确认
		console.log(
			`\n⚠ 提示: 请确保角色已下线（切换到其他角色），否则修改会被服务器覆盖。`,
		);
		const confirmed = await confirmYesNo(
			`确认将 ${toComplete.length} 个任务标记为完成?`,
			true,
		);
		if (!confirmed) {
			console.log("已取消。");
			return;
		}

		// 执行更新
		await connection.beginTransaction();
		try {
			for (const { slot, questIdx } of toComplete) {
				await connection.execute(
					`UPDATE taiwan_cain.new_charac_quest SET play_${slot}_trigger = 0 WHERE charac_no = ?`,
					[characNo],
				);
				console.log(`  ✓ quest ${questIdx} (槽位 ${slot}): trigger → 0`);

				// 如果有物品数据，发送邮件
				const items = questItemMap.get(questIdx);
				if (items && items.length > 0) {
					const [letterResult] =
						await connection.execute<mysql.ResultSetHeader>(
							`INSERT INTO taiwan_cain_2nd.letter (charac_no, send_charac_no, send_charac_name, letter_text, reg_date, stat)
						 VALUES (?, 0, 'GM', '任务奖励', NOW(), 1)`,
							[characNo],
						);
					const letterId = letterResult.insertId;

					for (const item of items) {
						await connection.execute(
							`INSERT INTO taiwan_cain_2nd.postal (
								occ_time, send_charac_name, receive_charac_no,
								amplify_option, amplify_value, seperate_upgrade, seal_flag,
								item_id, add_info, upgrade, gold, letter_id,
								avata_flag, creature_flag, endurance, unlimit_flag
							) VALUES (
								NOW(), 'GM', ?,
								0, 0, 0, 0,
								?, ?, 0, 0, ?,
								0, 0, 0, 1
							)`,
							[characNo, item.item_id, item.count, letterId],
						);
					}
					console.log(
						`    → 已发送 ${items.length} 种物品到邮箱 (letter_id=${letterId})`,
					);
				}
			}

			await connection.commit();
		} catch (error) {
			await connection.rollback();
			throw error;
		}

		console.log(`\n✓ 任务完成操作成功!`);
		console.log(`  角色: ${characName} (charac_no=${characNo})`);
		console.log(`  完成: ${toComplete.length} 个任务`);
		if (flags.items) {
			console.log(`  物品: 已通过邮件发放`);
		}
		console.log(`\n⚠ 重要: 请先切换到其他角色，再切换回来，任务状态才会生效。`);
		console.log(
			`  原因: 游戏服务器会将角色数据缓存在内存中，在线时修改数据库会被覆盖。`,
		);
	} catch (error) {
		console.error("✗ 操作过程中发生错误:");
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

interface ParsedArgs {
	_: string[];
	quest: number[];
	all: boolean;
	items: string | null;
}

function parseArgs(args: string[]): ParsedArgs {
	const result: ParsedArgs = { _: [], quest: [], all: false, items: null };
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === undefined) {
			i++;
			continue;
		}
		if (arg === "--quest" && i + 1 < args.length) {
			i++;
			const questArg = args[i];
			if (questArg !== undefined) {
				result.quest.push(Number(questArg));
			}
		} else if (arg === "--all") {
			result.all = true;
		} else if (arg === "--items" && i + 1 < args.length) {
			i++;
			const itemsPath = args[i];
			if (itemsPath !== undefined) {
				result.items = itemsPath;
			}
		} else {
			result._.push(arg);
		}
		i++;
	}
	return result;
}

async function fetchCharacInfoByName(
	connection: mysql.Connection,
	characName: string,
): Promise<mysql.RowDataPacket | null> {
	const [rows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT charac_no, charac_name
		 FROM taiwan_cain.charac_info
		 WHERE charac_name = ?
		 LIMIT 1`,
		[characName],
	);
	if (!rows || rows.length === 0) return null;
	return rows[0] ?? null;
}

async function readQuestSlots(
	connection: mysql.Connection,
	characNo: number,
): Promise<Record<string, unknown> | null> {
	const [rows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT * FROM taiwan_cain.new_charac_quest WHERE charac_no = ?`,
		[characNo],
	);
	if (!rows || rows.length === 0) return null;
	return rows[0] ?? null;
}
