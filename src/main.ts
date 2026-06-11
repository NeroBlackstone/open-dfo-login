import { backupCommand } from "./commands/backup.ts";
import { initCommand } from "./commands/init.ts";
import { listBackupCommand } from "./commands/list-backup.ts";
import { listCharacterCommand } from "./commands/list-character.ts";
import { loginCommand } from "./commands/login.ts";
import { lookupCommand } from "./commands/lookup.ts";
import { restoreCommand } from "./commands/restore.ts";
import { signupCommand } from "./commands/signup.ts";
import { hasConfigFile } from "./db-config.ts";
import { printHelp } from "./help.ts";

/**
 * CLI 入口
 */
export async function main(argv: readonly string[]): Promise<number> {
	const subcommand = argv[2];
	switch (subcommand) {
		case "init":
			await initCommand();
			return 0;
		case "signup":
			await signupCommand();
			return 0;
		case "login":
			await loginCommand();
			return 0;
		case "lookup":
			await lookupCommand(argv.slice(3));
			return 0;
		case "list-character":
			await listCharacterCommand(argv.slice(3));
			return 0;
		case "list-backup":
			await listBackupCommand(argv.slice(3));
			return 0;
		case "backup":
			await backupCommand(argv.slice(3));
			return 0;
		case "restore":
			await restoreCommand(argv.slice(3));
			return 0;
		case "help":
		case "-h":
		case "--help":
			printHelp();
			return 0;
		case undefined:
			// 无显式子命令:未配置则自动进入 init,否则打印帮助
			if (!hasConfigFile()) {
				console.log("未检测到 ~/.dfo-login/db_config.json,自动进入 init。\n");
				await initCommand();
			} else {
				printHelp();
			}
			return 0;
		default:
			console.error(`未知子命令: ${subcommand}`);
			printHelp();
			return 1;
	}
}
