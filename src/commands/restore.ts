import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import mysql from "mysql2/promise";
import { getUidByAccountName } from "../auth.ts";
import { BACKUPS_DIR } from "../constants.ts";
import { getCurrentDbConfig } from "../db-config.ts";
import { confirmYesNo, readLinePlain } from "../prompts.ts";
import type { BackupBufferLike, BackupFile } from "../types.ts";

/**
 * dfo-login restore <目标账户名> <备份文件 basename>:
 * 读取 ~/.dfo-login/backups/<basename> 的 JSON,分配新 charac_no,把数据写入目标账号。
 * 整操作一个事务:任一 INSERT 失败整体回滚。
 *
 * 设计点(详见 /home/gaowanxiang/.claude/plans/json-zany-teacup.md):
 * - 新 charac_no 总是 MAX(charac_no)+1,跨账号恢复时安全
 * - m_id 改写为目标 uid
 * - charac_name 全局唯一,冲突时交互提示改名
 * - 不动源账号、不动目标账号的 account-level 10 张表
 * - BLOB 经 __buf 信封还原成 Buffer
 */
export async function restoreCommand(args: string[]): Promise<void> {
	console.log("=== 角色恢复 (restore) ===");

	const targetAccount = args[0]?.trim();
	const fileName = args[1]?.trim();
	if (!targetAccount || !fileName) {
		console.error("✗ 用法: dfo-login restore <目标账户名> <备份文件 basename>");
		process.exit(1);
	}

	// 1) 加载 + 校验备份文件
	const filePath = join(BACKUPS_DIR, fileName);
	if (!existsSync(filePath)) {
		console.error(
			`✗ 备份文件不存在: ${filePath}\n  请用 dfo-login list-backup 查看现有备份。`,
		);
		process.exit(1);
	}

	let backup: BackupFile;
	try {
		const raw = readFileSync(filePath, "utf-8");
		const payload = JSON.parse(raw) as { manifest?: unknown; data?: unknown };
		validateBackup(payload);
		backup = payload as BackupFile;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`✗ 读取或解析备份失败: ${msg}`);
		process.exit(1);
	}

	const manifest = backup.manifest;

	// 2) 解析目标账号 uid
	const targetUid = await getUidByAccountName(targetAccount);
	if (targetUid === null) {
		console.error(
			`✗ 目标账户 "${targetAccount}" 不存在。请先运行 dfo-login signup 注册。`,
		);
		process.exit(1);
	}

	let connection: mysql.Connection | null = null;
	try {
		connection = await mysql.createConnection(getCurrentDbConfig());

		// 3) 预分配 newCharacNo = MAX(charac_no)+1
		const [maxRows] = await connection.execute<mysql.RowDataPacket[]>(
			"SELECT COALESCE(MAX(charac_no), 0) + 1 AS next FROM taiwan_cain.charac_info",
		);
		const nextRow = maxRows?.[0];
		const newCharacNo = Number(nextRow?.next);
		if (!Number.isInteger(newCharacNo) || newCharacNo <= 0) {
			throw new Error(
				`无法解析下一个 charac_no (raw=${String(nextRow?.next)})`,
			);
		}

		// 4) charac_name 冲突检测 + 提示改名
		const finalCharacName = await resolveCharacName(
			connection,
			manifest.charac_name,
		);
		if (finalCharacName === null) {
			console.log("已取消。");
			return;
		}

		// 5) 摘要 + 确认
		const tableCount = Object.keys(manifest.tables).length;
		const totalRows = Object.values(manifest.tables).reduce(
			(sum, n) => sum + (Number.isFinite(n) ? n : 0),
			0,
		);
		console.log(`源备份:     ${fileName}`);
		console.log(
			`源角色:     ${manifest.charac_name} (uid=${manifest.uid}, charac_no=${manifest.charac_no})`,
		);
		console.log(`备份时间:   ${formatIsoDate(manifest.backup_time)}`);
		console.log(`工具版本:   ${manifest.tool_version}`);
		console.log(`目标账号:   ${targetAccount} (uid=${targetUid})`);
		console.log(`新 charac_no: ${newCharacNo}`);
		console.log(`新 charac_name: ${finalCharacName}`);
		console.log(`表数量:     ${tableCount}   总行数: ${totalRows}`);

		const ok = await confirmYesNo(
			"确认恢复到目标账户? 此操作会写入大量行,不可撤销",
			false,
		);
		if (!ok) {
			console.log("已取消。");
			return;
		}

		// 6) 事务:逐表 INSERT
		await connection.beginTransaction();
		try {
			const fqns = Object.keys(backup.data).sort();
			let inserted = 0;
			for (const fqn of fqns) {
				const rows = backup.data[fqn];
				if (!rows || rows.length === 0) {
					console.log(`  - ${fqn}: 0 行`);
					continue;
				}
				const n = await insertTable(
					connection,
					fqn,
					rows,
					newCharacNo,
					finalCharacName,
					targetUid,
				);
				inserted += n;
				console.log(`  - ${fqn}: ${n} 行`);
			}
			await connection.commit();
			console.log(
				`\n✓ 恢复完成。新角色 charac_no=${newCharacNo} 已在账号 ${targetAccount} (uid=${targetUid}) 下。共写入 ${inserted} 行。`,
			);

			// 7) 更新 charac_view (账户级表,不在备份中)
			await updateCharacView(connection, targetUid);
		} catch (innerErr) {
			try {
				await connection.rollback();
			} catch (rbErr) {
				console.error("⚠ 回滚失败:", rbErr);
			}
			throw innerErr;
		}
	} catch (error) {
		console.error("✗ 恢复过程中发生错误,已回滚。请重试。");
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

/** 校验备份 JSON 形状,失败抛 Error。 */
function validateBackup(payload: unknown): asserts payload is BackupFile {
	if (!payload || typeof payload !== "object") {
		throw new Error("备份内容不是对象");
	}
	const obj = payload as { manifest?: unknown; data?: unknown };
	const m = obj.manifest as
		| { schema_version?: unknown; tool?: unknown }
		| undefined;
	if (!m || typeof m !== "object") {
		throw new Error("备份缺少 manifest");
	}
	if (m.schema_version !== 1) {
		throw new Error(`不支持的 schema_version: ${String(m.schema_version)}`);
	}
	if (m.tool !== "dfo-login") {
		throw new Error(`不匹配的 tool 字段: ${String(m.tool)}`);
	}
	if (!obj.data || typeof obj.data !== "object") {
		throw new Error("备份缺少 data");
	}
}

/**
 * 检查 charac_name 全局冲突。若无冲突返回原名;有冲突则交互提示改名;
 * 用户输入空行返回 null(取消);输入新名后再次检查,仍冲突则抛错。
 */
async function resolveCharacName(
	connection: mysql.Connection,
	originalName: string,
): Promise<string | null> {
	const probeName = async (name: string): Promise<boolean> => {
		const [rows] = await connection.execute<mysql.RowDataPacket[]>(
			"SELECT 1 FROM taiwan_cain.charac_info WHERE charac_name = ? LIMIT 1",
			[name],
		);
		return !!(rows && rows.length > 0);
	};

	if (!(await probeName(originalName))) return originalName;

	console.log(`⚠ 目标数据库已存在同名角色 "${originalName}"。`);
	const answer = await readLinePlain("输入新名字 (留空取消): ");
	const newName = answer.trim();
	if (!newName) return null;
	if (await probeName(newName)) {
		throw new Error(
			`新名字 "${newName}" 也已存在,无法继续。请手动改名后再恢复。`,
		);
	}
	return newName;
}

/**
 * 对单张表执行 INSERT。**每一行单独构建 INSERT 语句**,只为非 null 列生成列
 * 列表与占位符,让 MySQL 用列默认值填补未指定的列。这是处理"源 row 里某列
 * 是 null,但目标列 NOT NULL"的关键策略 —— 比按列名补丁更通用。
 *
 * 另:对 AUTO_INCREMENT 列(如 user_items.ui_id),从 INSERT 中跳过让 MySQL
 * 自动分配新 PK,避免与目标库已有 PK 冲突。**例外**:taiwan_cain.charac_info
 * 的 charac_no 我们手动算好 MAX+1,必须显式插入(这样新 charac_no 才会
 * 出现在事务前向用户展示的摘要里)。
 *
 * 改写:charac_no / m_id / charac_name 按目标改写;BLOB 还原 Buffer。
 */
async function insertTable(
	connection: mysql.Connection,
	fqn: string,
	rows: Record<string, unknown>[],
	newCharacNo: number,
	newCharacName: string,
	targetUid: number,
): Promise<number> {
	const dotIdx = fqn.indexOf(".");
	if (dotIdx <= 0 || dotIdx === fqn.length - 1) {
		throw new Error(`非法表名格式: ${fqn}`);
	}
	const schema = fqn.slice(0, dotIdx);
	const table = fqn.slice(dotIdx + 1);

	// 查询该表的 AUTO_INCREMENT 列(从 information_schema 拿,通用、零硬编码)
	const autoIncCols = await getAutoIncrementColumns(connection, schema, table);

	// 收集列名:取所有行 keys 的并集(按出现顺序稳定排列),用来做"哪些列可能要写"
	const seen = new Set<string>();
	const allColumns: string[] = [];
	for (const row of rows) {
		for (const k of Object.keys(row)) {
			if (!seen.has(k)) {
				seen.add(k);
				allColumns.push(k);
			}
		}
	}
	if (allColumns.length === 0) return 0;

	const isCharacInfo = fqn === "taiwan_cain.charac_info";

	let inserted = 0;
	for (const row of rows) {
		const remapped = remapRow(row, {
			newCharacNo,
			newCharacName,
			targetUid,
		});

		// 挑出要写入的列:
		//   - AUTO_INCREMENT 列跳过(让 MySQL 自动分配 PK),除非这是 charac_info.charac_no
		//   - null / undefined 跳过(让 MySQL 用列默认)
		const nonNullCols: string[] = [];
		const values: unknown[] = [];
		for (const c of allColumns) {
			if (autoIncCols.has(c) && !(isCharacInfo && c === "charac_no")) {
				continue;
			}
			const v = remapped[c];
			if (v === null || v === undefined) continue;
			nonNullCols.push(c);
			values.push(v);
		}
		if (nonNullCols.length === 0) continue;

		const colList = nonNullCols.map((c) => `\`${quoteIdent(c)}\``).join(", ");
		const placeholders = nonNullCols.map(() => "?").join(", ");
		const sql = `INSERT INTO \`${schema}\`.\`${table}\` (${colList}) VALUES (${placeholders})`;
		await connection.execute(
			sql,
			values as unknown as Array<string | number | Buffer | Date | null>,
		);
		inserted++;
	}
	return inserted;
}

/**
 * 从 information_schema 查某张表的所有 AUTO_INCREMENT 列,返回名称集合。
 * 一次查询,无硬编码,适用于 taiwan_cain / taiwan_cain_2nd 下任何表。
 */
async function getAutoIncrementColumns(
	connection: mysql.Connection,
	schema: string,
	table: string,
): Promise<Set<string>> {
	const [rows] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT COLUMN_NAME AS name
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME = ?
          AND EXTRA LIKE '%auto_increment%'`,
		[schema, table],
	);
	return new Set((rows ?? []).map((r) => String(r.name ?? "")));
}

/** 单行改写:charac_no / m_id / charac_name 重写;BLOB 还原 Buffer;其他原样。 */
function remapRow(
	row: Record<string, unknown>,
	opts: { newCharacNo: number; newCharacName: string; targetUid: number },
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (k === "charac_no") {
			out[k] = opts.newCharacNo;
		} else if (k === "m_id") {
			out[k] = opts.targetUid;
		} else if (k === "charac_name") {
			out[k] = opts.newCharacName;
		} else if (
			v !== null &&
			typeof v === "object" &&
			(v as { __buf?: unknown }).__buf === true &&
			typeof (v as { data?: unknown }).data === "string"
		) {
			out[k] = Buffer.from((v as BackupBufferLike).data, "base64");
		} else {
			out[k] = v;
		}
	}
	return out;
}

/** 反引号转义,防止列名包含反引号导致 SQL 错误。 */
function quoteIdent(s: string): string {
	return s.replace(/`/g, "``");
}

/** ISO 字符串 → 本地时区 YYYY-MM-DD HH:mm:ss,无效值显示 "-"。 */
function formatIsoDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "-";
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/**
 * 更新 charac_view 表(账户级表,游戏服务器用它来显示角色选择界面)。
 * 备份中不包含此表,恢复角色后必须手动更新。
 *
 * info Buffer 格式(逆向自游戏服务器):
 *   压缩前: 每个角色槽位 148 字节,共 36 个槽位 = 5328 字节
 *   槽位内:
 *     [0-3]   charac_no (uint32LE)
 *     [4-19]  charac_name (16 bytes, null-padded)
 *     [24-25] job (uint16LE)
 *     [26-27] village (uint16LE)
 *   压缩后: 4 字节头(未压缩长度 uint32LE) + zlib 压缩数据
 */
async function updateCharacView(
	connection: mysql.Connection,
	uid: number,
): Promise<void> {
	// 查询目标账户所有角色
	const [chars] = await connection.execute<mysql.RowDataPacket[]>(
		`SELECT charac_no, charac_name, job, village
		 FROM taiwan_cain.charac_info
		 WHERE m_id = ? AND delete_flag = 0
		 ORDER BY charac_no`,
		[uid],
	);

	const characCount = chars.length;
	if (characCount === 0) {
		console.log("  警告: 目标账户无角色,跳过 charac_view 更新。");
		return;
	}

	// 构建 info Buffer (解压前 5328 字节)
	const SLOT_SIZE = 148;
	const TOTAL_SLOTS = 36;
	const decompressed = Buffer.alloc(SLOT_SIZE * TOTAL_SLOTS, 0);

	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i] as mysql.RowDataPacket;
		const offset = i * SLOT_SIZE;
		decompressed.writeUInt32LE(Number(ch.charac_no), offset);
		const nameBuf = Buffer.from(String(ch.charac_name), "utf-8");
		nameBuf.copy(decompressed, offset + 4, 0, Math.min(nameBuf.length, 15));
		decompressed.writeUInt16LE(Number(ch.job), offset + 24);
		decompressed.writeUInt16LE(Number(ch.village), offset + 26);
	}

	// 压缩: 4 字节头(未压缩长度) + zlib
	const compressed = deflateSync(decompressed);
	const info = Buffer.alloc(4 + compressed.length);
	info.writeUInt32LE(decompressed.length, 0);
	compressed.copy(info, 4);

	// 插入或更新 charac_view
	const [existing] = await connection.execute<mysql.RowDataPacket[]>(
		"SELECT 1 FROM taiwan_cain.charac_view WHERE m_id = ? LIMIT 1",
		[uid],
	);

	if (existing.length === 0) {
		await connection.execute(
			`INSERT INTO taiwan_cain.charac_view
			 (m_id, info, slot_effect_count, charac_slot_limit, hash_key, charac_count)
			 VALUES (?, ?, 36, 36, '', ?)`,
			[uid, info, characCount],
		);
		console.log(`  charac_view: 已创建 (charac_count=${characCount})`);
	} else {
		await connection.execute(
			"UPDATE taiwan_cain.charac_view SET charac_count = ?, info = ? WHERE m_id = ?",
			[characCount, info, uid],
		);
		console.log(`  charac_view: 已更新 (charac_count=${characCount})`);
	}
}
