import mysql from "mysql2/promise";
import { getCurrentDbConfig } from "../db-config.ts";
import {
	askNonNegativeInt,
	confirmYesNo,
	readLinePlain,
} from "../prompts.ts";

interface MailItem {
	itemId: number;
	quantity: number;
}

/**
 * dfo-login mail [角色名]: 向指定角色发送游戏内邮件（物品）。
 * 交互式添加多个物品，确认后写入 letter + postal 表。
 */
export async function mailCommand(args: string[]): Promise<void> {
	console.log("=== 发送邮件 (mail) ===");

	// 1. 获取角色名
	let characName = args[0]?.trim();
	if (!characName) {
		characName = (await readLinePlain("角色名: ")).trim();
	}
	if (!characName) {
		console.error("✗ 角色名不能为空。");
		process.exit(1);
	}

	// 2. 查询角色
	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(getCurrentDbConfig());

		const [characRows] = await connection.execute<mysql.RowDataPacket[]>(
			"SELECT charac_no, charac_name, m_id FROM taiwan_cain.charac_info WHERE charac_name = ? LIMIT 1",
			[characName],
		);

		if (!characRows || characRows.length === 0) {
			console.error(`✗ 找不到角色 "${characName}"。`);
			process.exit(1);
		}

		const charac = characRows[0] as mysql.RowDataPacket;
		const characNo = charac.charac_no as number;
		const characDisplayName = charac.charac_name as string;

		console.log(`✓ 目标角色: ${characDisplayName} (charac_no=${characNo})\n`);

		// 3. 交互式添加物品
		const items: MailItem[] = [];
		while (true) {
			const itemIdStr = (
				await readLinePlain(`物品 ${items.length + 1} 的 ID (输入空行结束): `)
			).trim();

			if (!itemIdStr) {
				if (items.length === 0) {
					console.error("✗ 至少需要添加一个物品。");
					process.exit(1);
				}
				break;
			}

			const itemId = Number.parseInt(itemIdStr, 10);
			if (!Number.isInteger(itemId) || itemId <= 0) {
				console.error(`✗ 无效的物品 ID: ${itemIdStr}`);
				continue;
			}

			const quantity = await askNonNegativeInt("数量 (默认 1): ", 1);
			if (quantity <= 0) {
				console.error("✗ 数量必须大于 0。");
				continue;
			}

			items.push({ itemId, quantity });
			console.log(`  ✓ 已添加: item_id=${itemId} x${quantity}\n`);
		}

		// 4. 汇总确认
		console.log("\n即将发送邮件:");
		console.log(`  角色: ${characDisplayName} (charac_no=${characNo})`);
		console.log(`  物品数量: ${items.length} 种`);
		for (let i = 0; i < items.length; i++) {
			const item = items[i] as MailItem;
			console.log(`    [${i + 1}] item_id=${item.itemId}  x${item.quantity}`);
		}

		const confirmed = await confirmYesNo("确认发送?", true);
		if (!confirmed) {
			console.log("已取消。");
			return;
		}

		// 5. 事务写入数据库
		await connection.beginTransaction();
		try {
			// 插入 letter 表
			const [letterResult] = await connection.execute<mysql.ResultSetHeader>(
				`INSERT INTO taiwan_cain_2nd.letter (charac_no, send_charac_no, send_charac_name, letter_text, reg_date, stat)
				 VALUES (?, 0, 'GM', '系统邮件', NOW(), 1)`,
				[characNo],
			);
			const letterId = letterResult.insertId;

			// 插入 postal 表
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
					[characNo, item.itemId, item.quantity, letterId],
				);
			}

			await connection.commit();

			console.log(`\n✓ 邮件发送成功! letter_id=${letterId}`);
			console.log(`  共 ${items.length} 种物品已发送给 ${characDisplayName}`);
		} catch (error) {
			await connection.rollback();
			throw error;
		}
	} catch (error) {
		console.error("✗ 发送邮件时发生错误:");
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}
