import { BACKUPS_DIR } from "../constants.ts";
import { type BackupListEntry, listBackups } from "../storage.ts";
import type { BackupManifest } from "../types.ts";

/**
 * dfo-login list-backup [账户名]:列出 ~/.dfo-login/backups/ 下所有备份的元信息。
 * 无参时列出全部;传账户名时只显示该账号的备份。按文件 mtime 降序(最新优先)。
 */
export async function listBackupCommand(args: string[]): Promise<void> {
	console.log("=== 备份列表 (list-backup) ===");

	const accountFilter = args[0]?.trim() || null;

	let allEntries: BackupListEntry[];
	try {
		allEntries = listBackups(BACKUPS_DIR);
	} catch (error) {
		console.error("✗ 读取备份目录时发生错误,请重试。");
		console.error(error);
		process.exit(1);
	}

	const entries = accountFilter
		? allEntries.filter((e) => e.manifest?.account_name === accountFilter)
		: allEntries;

	// 按 mtime 降序排序,文件名为次级 tiebreaker (稳定排序)
	entries.sort((a, b) => {
		const dt = b.mtime.getTime() - a.mtime.getTime();
		if (dt !== 0) return dt;
		return a.fileName.localeCompare(b.fileName);
	});

	if (entries.length === 0 && !accountFilter) {
		console.log(`⚠ 未在 ${BACKUPS_DIR} 下找到任何备份。`);
		return;
	}
	if (entries.length === 0 && accountFilter) {
		console.log(
			`⚠ 未找到账户 "${accountFilter}" 的备份。用法: dfo-login list-backup [账户名]`,
		);
		return;
	}

	const totalCount = entries.length;
	console.log(
		`目录: ${BACKUPS_DIR}  匹配数: ${totalCount}` +
			(accountFilter ? `  过滤: account_name=${accountFilter}` : "") +
			"\n",
	);

	const good = entries.filter((e) => e.manifest !== null);
	const bad = entries.filter((e) => e.manifest === null);

	good.forEach((e, i) => {
		printEntry(i + 1, e);
		if (i < good.length - 1 || bad.length > 0) console.log("");
	});

	if (bad.length > 0) {
		console.log(
			`\n⚠ 以下 ${bad.length} 个文件无法解析,可能是损坏或不完整的备份:`,
		);
		for (const e of bad) {
			console.log(`  - ${e.fileName}: ${e.error ?? "未知错误"}`);
		}
	}
}

/**
 * 把单个有效备份打印成多行,字段顺序固定,方便纵向对比。
 */
function printEntry(index: number, e: BackupListEntry): void {
	const m = e.manifest as BackupManifest;
	const tableCount = Object.keys(m.tables).length;
	const totalRows = Object.values(m.tables).reduce(
		(sum, n) => sum + (Number.isFinite(n) ? n : 0),
		0,
	);
	console.log(
		`  [${index}] ${m.charac_name} (${m.account_name}) - charac_no=${m.charac_no}  uid=${m.uid}`,
	);
	console.log(`      备份时间: ${formatDate(new Date(m.backup_time))}`);
	console.log(`      工具版本: ${m.tool_version}`);
	console.log(`      表数量: ${tableCount}  总行数: ${totalRows}`);
	console.log(`      文件: ${e.fileName} (${formatBytes(e.sizeBytes)})`);
	console.log(`      路径: ${e.filePath}`);
}

/** 本地时区 YYYY-MM-DD HH:mm:ss,与 backup.ts 的 formatStamp 行为一致。 */
function formatDate(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/** B / KB / MB 自适应,保留 1 位小数。 */
function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "-";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
