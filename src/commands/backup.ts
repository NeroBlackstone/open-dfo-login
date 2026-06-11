import { join } from "node:path";
import mysql from "mysql2/promise";
import { getUidByAccountName } from "../auth.ts";
import { BACKUPS_DIR, TOOL_VERSION } from "../constants.ts";
import { getCurrentDbConfig } from "../db-config.ts";
import { confirmYesNo } from "../prompts.ts";
import { saveBackup } from "../storage.ts";
import type {
	BackupBufferLike,
	BackupFile,
	BackupManifest,
	BackupTableStats,
} from "../types.ts";

/**
 * dfo-login backup <账户名> <角色名>:备份指定角色在 taiwan_cain / taiwan_cain_2nd
 * 下全部含 charac_no 列的表到 ~/.dfo-login/backups/<account>_<charac>_<时间戳>.json。
 */
export async function backupCommand(args: string[]): Promise<void> {
	console.log("=== 角色备份 (backup) ===");

	const accountName = args[0]?.trim();
	const characName = args[1]?.trim();
	if (!accountName || !characName) {
		console.error("✗ 用法: dfo-login backup <账户名> <角色名>");
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

		const characRow = await fetchCharacInfo(connection, uid, characName);
		if (!characRow) {
			console.error(
				`✗ 账户 ${accountName} 下未找到角色 "${characName}"。请先运行 dfo-login list-character ${accountName} 确认角色名。`,
			);
			process.exit(1);
		}

		const characNo = characRow.charac_no as number;
		const deleteFlag = Number(characRow.delete_flag ?? 0);
		if (deleteFlag !== 0) {
			console.log(`⚠ 该角色 delete_flag=${deleteFlag},已删除。`);
			const proceed = await confirmYesNo("仍要备份已删除的角色?", false);
			if (!proceed) {
				console.log("已取消。");
				return;
			}
		}

		const tables = await enumerateCharacTables(connection);
		console.log(`找到 ${tables.length} 张含 charac_no 的表,开始备份:\n`);

		const tableStats: BackupTableStats = {};
		const data: BackupFile["data"] = {};
		let totalRows = 0;

		for (const { schema, table } of tables) {
			const fqn = `${schema}.${table}`;
			const [rows] = await connection.execute<mysql.RowDataPacket[]>(
				`SELECT * FROM \`${schema}\`.\`${table}\` WHERE charac_no = ?`,
				[characNo],
			);
			const processed = (rows ?? []).map((r) =>
				processRow(r as Record<string, unknown>),
			);
			data[fqn] = processed;
			tableStats[fqn] = processed.length;
			totalRows += processed.length;
			console.log(`  - ${fqn}: ${processed.length} 行`);
		}

		const manifest: BackupManifest = {
			schema_version: 1,
			tool: "dfo-login",
			tool_version: TOOL_VERSION,
			account_name: accountName,
			uid,
			charac_no: characNo,
			charac_name: characName,
			backup_time: new Date().toISOString(),
			source_schemas: ["taiwan_cain", "taiwan_cain_2nd"],
			tables: tableStats,
		};

		const file: BackupFile = { manifest, data };
		const stamp = formatStamp(new Date());
		const fileName = `${sanitize(accountName)}_${sanitize(characName)}_${stamp}.json`;
		const filePath = join(BACKUPS_DIR, fileName);

		saveBackup(filePath, file);

		const tableCount = Object.keys(tableStats).length;
		console.log(`\n✓ 备份完成`);
		console.log(`  路径: ${filePath}`);
		console.log(`  表数: ${tableCount}   总行数: ${totalRows}`);
		console.log(`  BLOB 字段已转为 base64 (BackupBufferLike)`);
	} catch (error) {
		console.error("✗ 备份过程中发生错误,请重试。");
		console.error(error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
		}
	}
}

/**
 * 按 (uid, charac_name) 在 charac_info 里查角色。理论上 UNIQUE,
 * 命中 0 行返回 null,>1 行抛错 (数据异常)。
 */
async function fetchCharacInfo(
	connection: mysql.Connection,
	uid: number,
	characName: string,
): Promise<mysql.RowDataPacket | null> {
	const [rows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT charac_no, charac_name, delete_flag
       FROM taiwan_cain.charac_info
      WHERE m_id = ? AND charac_name = ?
      LIMIT 1`,
		[uid, characName],
	);
	if (!rows || rows.length === 0) return null;
	if (rows.length > 1) {
		throw new Error(
			`角色 "${characName}" 在数据库中匹配到 ${rows.length} 行,违反 charac_name UNIQUE 约束`,
		);
	}
	return rows[0] ?? null;
}

/**
 * 动态枚举 taiwan_cain / taiwan_cain_2nd 下含 charac_no 列的表。
 */
async function enumerateCharacTables(
	connection: mysql.Connection,
): Promise<{ schema: string; table: string }[]> {
	const [rows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`
       FROM information_schema.COLUMNS
      WHERE COLUMN_NAME = 'charac_no'
        AND TABLE_SCHEMA IN ('taiwan_cain', 'taiwan_cain_2nd')
      GROUP BY TABLE_SCHEMA, TABLE_NAME
      ORDER BY TABLE_SCHEMA, TABLE_NAME`,
	);
	return (rows ?? []).map((r) => ({
		schema: String(r.schema ?? ""),
		table: String(r.table ?? ""),
	}));
}

/**
 * 把 Buffer 字段 (BLOB) 编码为 base64,其他字段保持原样。
 * 还原约定: 检测到 obj?.__buf === true && typeof obj.data === "string" 时,
 * Buffer.from(obj.data, "base64")。
 */
function processRow(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		out[k] = Buffer.isBuffer(v)
			? ({ __buf: true, data: v.toString("base64") } satisfies BackupBufferLike)
			: v;
	}
	return out;
}

/** 非 [A-Za-z0-9_-] 替换为 _,防止文件名注入 / 跨平台兼容。 */
function sanitize(s: string): string {
	return s.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** 本地时区 YYYYMMDD-HHMMSS */
function formatStamp(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
		`-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}
