// 数据库配置接口
export interface DatabaseConfig {
	host: string;
	port: number;
	user: string;
	password: string;
}

// 登录结果接口
export interface LoginResult {
	stat: number;
	token: string | null;
	info: string;
}

// 注册结果接口
export interface RegisterResult {
	stat: number;
	info: string;
}

// 角色概要 (list-character 命令输出)
export interface CharacterSummary {
	charac_no: number;
	charac_name: string;
	village: number;
	job: number;
	lev: number;
	exp: number;
	create_time: Date;
	last_play_time: Date;
	delete_flag: number;
	guild_id: number;
	vip: string;
	counts: {
		inventory: number;
		user_items: number;
		skill: number;
		charac_stat: number;
		combo_skill: number;
	};
}

// 列出指定账号下角色 的结果
export interface ListCharacterResult {
	stat: 0 | 1;
	info: string;
	uid: number | null;
	characters: CharacterSummary[];
}

// 备份文件 BLOB 字段序列化约定: { __buf: true, data: "<base64>" }
// 还原时 Buffer.from(s, "base64")
export interface BackupBufferLike {
	__buf: true;
	data: string;
}

// 备份文件中 tableFqn -> 行数
export type BackupTableStats = Record<string, number>;

export interface BackupManifest {
	schema_version: 1;
	tool: "dfo-login";
	tool_version: string;
	account_name: string;
	uid: number;
	charac_no: number;
	charac_name: string;
	backup_time: string;
	source_schemas: ["taiwan_cain", "taiwan_cain_2nd"];
	tables: BackupTableStats;
}

export interface BackupFile {
	manifest: BackupManifest;
	data: Record<string, Record<string, unknown>[]>;
}

export interface BackupResult {
	stat: 0 | 1;
	info: string;
	file_path?: string;
	table_count?: number;
	total_rows?: number;
}
