Env Switch Script

The repo includes a helper to switch between local and cloud env configs without manual editing.

Script: `scripts/envswitch.py`

Preset Location
- Put your private presets under `.env-presets/` (git-ignored).
- File names:
  - `frontend.<profile>.env`  -> applied to `frontend/.env.local`
  - `backend.<profile>.env`   -> applied to `backend/.env`

Partial apply (default)
- Applying a preset now only updates keys present in the preset; other lines in the target `.env` stay unchanged.
- Tip: delete any keys from the preset file that you never want overridden (e.g., long-lived secrets).

Examples
- Save current files as preset `local`:
  `python scripts/envswitch.py save local -y`

- Apply preset `cloud` to both frontend & backend (default: no backups):
  `python scripts/envswitch.py apply cloud -y`

- Limit to just frontend or backend:
  `python scripts/envswitch.py apply local --only frontend -y`

- Show what would change:
  `python scripts/envswitch.py diff cloud`

- Enable backups when applying:
  `python scripts/envswitch.py apply local -y --backup`

Env var default
- 在需要时启用备份（当前会话）：
  `export ENVSWITCH_BACKUP=1`
  之后直接 `python scripts/envswitch.py apply cloud -y` 即会生成备份。

- List available profiles:
  `python scripts/envswitch.py list`

Notes
- `save` still copies the entire env file into the preset; edit the preset afterwards to trim keys you don't want managed.
- Backups are created when `--backup` 或 `ENVSWITCH_BACKUP=1`.
- `.env-presets/` is git-ignored to avoid committing secrets.
- Create `local` / `cloud` presets once, then switching is instant.
