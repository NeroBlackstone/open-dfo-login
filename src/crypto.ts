import crypto from "node:crypto";

/**
 * token 载荷固定部分 (与 Python 旧实现一致;包含 64 字节 0x01 + 帧头/校验字段)。
 * 拼接规则:uid 8 位小写 hex + 此字符串。
 */
const TOKEN_PAYLOAD_SUFFIX_HEX =
	"010101010101010101010101010101010101010101010101010101010101010155914510010403030101";

/** 对密码做 MD5 散列 (服务端数据库中存的就是 MD5)。 */
export function hashPassword(password: string): string {
	return crypto.createHash("md5").update(password).digest("hex");
}

/**
 * 生成游戏登录 token:把 uid + 固定后缀的字节流用 RSA 私钥加密 (PKCS#1 v1.5),
 * 结果 base64 编码。对应 Python 端 `openssl_private_encrypt`。
 */
export function generateToken(uid: number, privateKey: string): string {
	const dataHex =
		`${uid.toString(16).padStart(8, "0")}${TOKEN_PAYLOAD_SUFFIX_HEX}`;
	const dataBuffer = Buffer.from(dataHex, "hex");

	console.log("login uid:", uid);
	console.log(`账号登陆${uid}`);

	// PKCS#1 v1.5 填充,服务端按相同 padding 解密。
	const encrypted = crypto.privateEncrypt(
		{
			key: privateKey,
			padding: crypto.constants.RSA_PKCS1_PADDING,
		},
		dataBuffer,
	);
	return encrypted.toString("base64");
}
