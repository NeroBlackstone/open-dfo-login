# dfo-login

A [Bun](https://bun.com)-powered CLI for managing accounts on a private DFO server: configure the database, register accounts, log in, and produce a game-client login token.

## Quick start (no install)

If you only have [Bun](https://bun.com) installed, you can run the latest published version directly — no clone, no `bun install`:

```bash
bunx dfo-login --help                # show help
bunx dfo-login init                  # configure DB connection + paste RSA private key
bunx dfo-login signup                # register a new account
bunx dfo-login login                 # log in, print the game token, cache it
bunx dfo-login lookup                # list cached account names
bunx dfo-login lookup <name>         # print the cached token for <name>
bunx dfo-login list-character <name> # list all characters for <name>
bunx dfo-login list-backup           # list all backups
bunx dfo-login backup <account> <character> # backup a character to JSON
bunx dfo-login restore <account> <file>     # restore a backup to <account>
bunx dfo-login recharge-cera <name> <amount>       # add CERA (premium currency) to an account
bunx dfo-login recharge-cera-point <name> <amount> # add CERA POINT to an account
bunx dfo-login mail [character]     # send in-game mail (items) to a character
```

Pin a specific version if you want reproducible behavior:

```bash
bunx dfo-login@0.1.0 login
```

The first run will create `~/.dfo-login/` for the config, private key, and token cache.

## Requirements

- [Bun](https://bun.com) >= 1.3
- A MySQL instance with the `d_taiwan`, `taiwan_login`, `taiwan_billing`, `taiwan_cain_2nd`, and `taiwan_cain` schemas already in place (this tool does not create them)
- The RSA private key (PEM) matching the game server

## Database schema

This tool reads/writes a small slice of the private DFO MySQL layout. The five relevant schemas hold the account tables, login state, billing, character data, and the character-info bridge. The relationship between them is:

```
d_taiwan.accounts (uid)                ── m_id ──┐
   │                                            │
   ├─ d_taiwan.member_info                     │
   ├─ d_taiwan.limit_create_character          │  account-level
   ├─ d_taiwan.member_join_info                │  (one row per
   ├─ d_taiwan.member_miles                    │   account)
   ├─ d_taiwan.member_white_account            │
   ├─ taiwan_login.member_login                │
   ├─ taiwan_billing.cash_cera ─── account ────┤
   ├─ taiwan_billing.cash_cera_point ── account ┤
   └─ taiwan_cain_2nd.member_avatar_coin ──────┘
                                                │
                                                ▼
                              taiwan_cain.charac_info (m_id → uid)
                                                │ charac_no
                                                ▼
                              character-level tables in
                              taiwan_cain / taiwan_cain_2nd
                              (inventory, user_items, skill, ...)
```

### Account-level tables (written by `signup`)

Ten tables receive a row per new account. Each has `m_id` (or equivalent) as the foreign key into `d_taiwan.accounts.uid`.

| Table | PK | Linked by | Purpose |
| --- | --- | --- | --- |
| `d_taiwan.accounts` | `uid` | `uid` | Login credentials: `accountname`, MD5 `password`, `qq`, `dzuid`, `billing`, `VIP` |
| `d_taiwan.limit_create_character` | `m_id` | `m_id` | Per-account character-creation quota / last access |
| `d_taiwan.member_info` | `m_id` | `m_id` | Member profile (Neopets-style: `user_id`, `passwd`, `email`, secret question) |
| `d_taiwan.member_join_info` | `m_id` | `m_id` | Registration IP, country code, last login |
| `d_taiwan.member_miles` | `m_id` | `m_id` | Membership miles |
| `d_taiwan.member_white_account` | `m_id` | `m_id` | Whitelist flag |
| `taiwan_login.member_login` | `m_id` | `m_id` | Login state: `login_time`, `expire_time`, `security_flag`, `dungeon_gain_gold`, `garena_token_key`, etc. |
| `taiwan_billing.cash_cera` | `account` | `account` (varchar(30) = uid) | CERA (premium currency) balance |
| `taiwan_billing.cash_cera_point` | `account` | `account` | CERA POINT balance |
| `taiwan_cain_2nd.member_avatar_coin` | `m_id` | `m_id` | Avatar coin balance |

### Character bridge

`list-character` and the (planned) backup commands route account → characters through one canonical table:

| Table | PK | FK | Notes |
| --- | --- | --- | --- |
| `taiwan_cain.charac_info` | `charac_no` | `m_id` → `d_taiwan.accounts.uid` | 53-column character master record: `charac_name` (UNIQUE), `village`, `job`, `lev`, `exp`, stats, `guild_id`, `VIP`, `create_time`, `last_play_time`, `delete_flag` |

### `charac_view` — character selection screen

`charac_view` is the account-level table that the game server reads to render the character selection screen. Each row is keyed by `m_id` (account uid). The critical column is `info` — a zlib-compressed binary blob encoding all characters for that account.

#### `info` buffer layout

```
[0-3]   uint32LE   uncompressed data length (always 5328)
[4..]   zlib-compressed payload
```

The decompressed payload is **5328 bytes**, divided into **36 slots × 148 bytes per slot**. Each slot represents one character position on the selection screen:

| Offset | Size | Type | Field |
| ------ | ---- | ---- | ----- |
| 0–3 | 4 | uint32LE | `charac_no` (0 = empty slot) |
| 4–19 | 16 | bytes | `charac_name` (UTF-8, null-padded) |
| 24–25 | 2 | uint16LE | `job` (0=Slayer, 1=Fighter, …) |
| 26–27 | 2 | uint16LE | `village` (spawn village id) |

The rest of each 148-byte slot is padding (zeros) — the game server only reads the fields listed above.

**Important**: the `restore` command automatically rebuilds `charac_view` after inserting rows. The slot size (148) and field offsets (24, 26) were determined by reverse-engineering the original server's `charac_view` data. Do not change these values without verifying against the actual game client behavior.

#### Other `charac_view` columns

| Column | Typical value | Meaning |
| ------ | ------------- | ------- |
| `charac_count` | number of non-deleted characters | displayed by some UI elements |
| `slot_effect_count` | 36 | total slot count for effects |
| `charac_slot_limit` | 36 | max character slots |
| `hash_key` | `''` (empty) | unused in this implementation |

### Character-level tables (key ones used by `list-character`)

These are all keyed by `charac_no` (and never contain `m_id` directly — always join through `charac_info`). There are 50+ such tables across `taiwan_cain` and `taiwan_cain_2nd`; `list-character` only summarises row counts for the most gameplay-relevant ones:

| Table | What it stores |
| --- | --- |
| `taiwan_cain_2nd.inventory` | Per-character inventory blob (items, equipment, creature) |
| `taiwan_cain_2nd.user_items` | Owned items (potions, equipment, materials, with `jewel_socket` blob) |
| `taiwan_cain_2nd.skill` | Skill tree state (`skill_slot`, `remain_sp`, etc.) |
| `taiwan_cain_2nd.combo_skill` / `combo_skill_2nd` | Combo skill slots |
| `taiwan_cain_2nd.fair_pvp_score` | PvP win/loss, ranking, mission info |
| `taiwan_cain_2nd.charac_inven_expand` | Inventory expansion count |
| `taiwan_cain.charac_stat` / `charac_option` / `charac_achievement` | Stats, UI options, achievements |
| `taiwan_cain.charac_kill_monster_info` / `charac_npc` / `charac_quest_shop` | Quest / NPC progress |
| `taiwan_cain.charac_titlebook` / `charac_dungeon_clear` / `new_charac_quest` / `pvp_result` | Titles, dungeon records, quests |

### Backup (`backup <account> <charac>`)

`backup <account> <charac>` enumerates every table that has a `charac_no` column across `taiwan_cain` + `taiwan_cain_2nd` (via `information_schema.COLUMNS`) and SELECTs rows for the matching `charac_no`. Output is a single JSON file at `~/.dfo-login/backups/<account>_<charac>_<YYYYMMDD-HHMMSS>.json` with a `manifest` (metadata) and `data` (table → rows[]) sections. BLOB columns (e.g. `inventory.inventory`, `user_items.jewel_socket`) are serialized as `{ __buf: true, data: "<base64>" }` for round-trip safety.

### Restore (`restore <target_account> <backup_file>`)

`restore` is the inverse of `backup`. It reads a JSON file from `~/.dfo-login/backups/` and inserts every row into the database under `<target_account>` — which may differ from the original `manifest.account_name` (cross-account migration). Key behavior:

- **New `charac_no`**: always allocated as `MAX(charac_no) + 1` across the whole `charac_info` table. This makes restore repeatable and safe even when the target account already has characters; the source `charac_no` from the manifest is **not** reused.
- **Account FK rewriting**: every `m_id` column on character-level rows is rewritten to the target account's `uid`. `charac_info.charac_name` is rewritten to the chosen final name. The 10 account-level tables (written by `signup`) are **not** touched — the target account must already exist.
- **`charac_name` uniqueness**: `charac_name` is UNIQUE globally. If the source name already exists in the database, the CLI prompts interactively for a new name (empty input cancels the restore).
- **BLOB round-trip**: `__buf` envelopes are decoded back to `Buffer` before binding as BLOB parameters.
- **Atomic**: a single transaction wraps every `INSERT`. If any row fails, the whole restore rolls back and nothing is written. You will be asked to confirm (`yes`/`no`, default `no`) before the transaction starts.
- **No source-side effect**: the source account, the source character, and the backup file are never modified.

## Install (local development)

```bash
git clone <repo> && cd open-dfo-login
bun install
```

## Commands

| Command | Description |
| --- | --- |
| `init` | Interactively configure the DB connection and RSA private key; outputs go to `~/.dfo-login/` |
| `signup` | Interactively register a new account (name, password, QQ, initial CERA / CERA POINT) |
| `login` | Interactively log in, print the full game token, append to `tokens.json` |
| `lookup [name]` | Look up a cached token. With no argument, lists all cached account names |
| `list-character <name>` | List all characters (with summary: level, job, inventory item counts, etc.) for the given account |
| `backup <account> <charac>` | Dump all character-level DB rows for the named character to a JSON file under `~/.dfo-login/backups/` |
| `restore <target_account> <backup_file>` | Restore a backup JSON to the target account. Allocates a fresh `charac_no` (max+1) and rewrites `m_id` so the character is owned by the target account. All-or-nothing transaction |
| `recharge-cera <name> <amount>` | Add CERA (premium currency) to the specified account. `amount` must be positive |
| `recharge-cera-point <name> <amount>` | Add CERA POINT to the specified account. `amount` must be positive |
| `help` | Print help |

## Files in `~/.dfo-login/`

```
db_config.json   # DB connection (host/port/user/password)
private_key.pem  # RSA private key, mode 0600
tokens.json      # plaintext (accountName -> token) cache
```

`tokens.json` is a plaintext token cache -- treat it as a credential.

## Security notes

- The private key file is written with `0600` and is only read at login time; it is never printed to the terminal.
- Passwords are MD5-hashed before being sent to the DB, matching the server's stored format. Plaintext passwords are never persisted.
- The game token is printed to stdout and also cached in `tokens.json`. Reuse the cached token via `lookup` rather than logging in again.

## Development

```bash
bunx tsc --noEmit                   # type check
bunx @biomejs/biome check .         # format + lint
```

## License

For personal study of the DFO private server protocol only. Please delete within 24 hours.
