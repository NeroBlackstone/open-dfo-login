import mysql from "mysql2/promise";
import { getUidByAccountName } from "../auth.ts";
import { getCurrentDbConfig } from "../db-config.ts";
import type { CharacterSummary } from "../types.ts";

/**
 * dfo-login list-character <账户名>:列出指定账号下所有角色概要。
 * 必传账户名;不在 accounts 表里报错退出;无角色时正常返回 (退出码 0)。
 */
export async function listCharacterCommand(args: string[]): Promise<void> {
	console.log("=== 角色查询 (list-character) ===");

	const accountName = args[0]?.trim();
	if (!accountName) {
		console.error("✗ 请提供账户名。用法: dfo-login list-character <账户名>");
		process.exit(1);
	}

	const uid = await getUidByAccountName(accountName);
	if (uid === null) {
		console.error(
			`✗ 账户 "${accountName}" 不存在。请先运行 dfo-login signup 注册。`,
		);
		process.exit(1);
	}

	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(getCurrentDbConfig());

		const [characRows] = await connection.execute<mysql.RowDataPacket[]>(
			`SELECT charac_no, charac_name, village, job, lev, exp,
                    create_time, last_play_time, delete_flag, guild_id, VIP
               FROM taiwan_cain.charac_info
              WHERE m_id = ?
              ORDER BY charac_no ASC`,
			[uid],
		);

		const rows = characRows ?? [];
		if (rows.length === 0) {
			console.log(
				`账户 ${accountName} (uid=${uid}) 下暂无角色。请用游戏客户端登录后创建。`,
			);
			return;
		}

		console.log(`账户: ${accountName} (uid=${uid})  角色数: ${rows.length}\n`);

		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (!r) continue;
			const summary = await loadCharacterSummary(connection, r);
			printCharacter(i + 1, summary);
			if (i < rows.length - 1) console.log("");
		}
	} catch (error) {
		console.error("✗ 查询角色列表时发生错误,请重试。");
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

/**
 * 把 charac_info 的一行 + 5 张主要角色级表的行数合并成 CharacterSummary。
 * 用 UNION ALL 一次往返完成 5 张表的 COUNT。
 */
async function loadCharacterSummary(
	connection: mysql.Connection,
	row: mysql.RowDataPacket,
): Promise<CharacterSummary> {
	const characNo = row.charac_no as number;
	const [countRows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT 'inventory'    AS src, COUNT(*) AS cnt FROM taiwan_cain_2nd.inventory   WHERE charac_no = ?
		 UNION ALL
		 SELECT 'user_items',        COUNT(*)         FROM taiwan_cain_2nd.user_items   WHERE charac_no = ?
		 UNION ALL
		 SELECT 'skill',             COUNT(*)         FROM taiwan_cain_2nd.skill        WHERE charac_no = ?
		 UNION ALL
		 SELECT 'charac_stat',       COUNT(*)         FROM taiwan_cain.charac_stat      WHERE charac_no = ?
		 UNION ALL
		 SELECT 'combo_skill',       COUNT(*)         FROM taiwan_cain_2nd.combo_skill  WHERE charac_no = ?`,
		[characNo, characNo, characNo, characNo, characNo],
	);

	const counts = {
		inventory: 0,
		user_items: 0,
		skill: 0,
		charac_stat: 0,
		combo_skill: 0,
	};
	for (const cr of countRows ?? []) {
		const key = cr.src as keyof typeof counts;
		const n = Number(cr.cnt);
		if (key in counts) counts[key] = Number.isFinite(n) ? n : 0;
	}

	return {
		charac_no: characNo,
		charac_name: String(row.charac_name ?? ""),
		village: Number(row.village ?? 0),
		job: Number(row.job ?? 0),
		lev: Number(row.lev ?? 0),
		exp: Number(row.exp ?? 0),
		create_time: row.create_time as Date,
		last_play_time: row.last_play_time as Date,
		delete_flag: Number(row.delete_flag ?? 0),
		guild_id: Number(row.guild_id ?? 0),
		vip: String(row.VIP ?? ""),
		counts,
	};
}

/**
 * 把单个角色打印成多行,方便人眼扫读。
 */
function printCharacter(index: number, c: CharacterSummary): void {
	const status = c.delete_flag === 0 ? "正常" : "已删除";
	console.log(
		`  [${index}] charac_no=${c.charac_no}  名称=${c.charac_name}  状态=${status}`,
	);
	console.log(
		`      职业 job=${c.job}  村庄 village=${c.village}  等级 lev=${c.lev}  经验 exp=${c.exp}  VIP=${c.vip}`,
	);
	console.log(`      公会 guild_id=${c.guild_id}`);
	console.log(
		`      创建 create_time=${formatDate(c.create_time)}  最近登录 last_play_time=${formatDate(c.last_play_time)}`,
	);
	console.log(
		`      概要: inventory=${c.counts.inventory} user_items=${c.counts.user_items} skill=${c.counts.skill} charac_stat=${c.counts.charac_stat} combo_skill=${c.counts.combo_skill}`,
	);
}

/**
 * MySQL 的 0000-00-00 会被 mysql2 转成 Invalid Date,这种值显示为 "-"。
 */
function formatDate(d: Date | null | undefined): string {
	if (!d) return "-";
	if (Number.isNaN(d.getTime())) return "-";
	return d.toISOString();
}
