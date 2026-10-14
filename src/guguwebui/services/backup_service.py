"""读取备份插件存储并通过公开命令执行写操作。"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Literal

from guguwebui.services.server_service import ServerService
from guguwebui.utils.mc_util import get_minecraft_path
from guguwebui.utils.mcdr_adapter import MCDRAdapter

Provider = Literal["primebackup", "quickbackupm"]


class BackupService:
    def __init__(self, server, server_service: ServerService):
        self.server = server
        self.server_service = server_service

    def working_dir(self) -> Path:
        return Path(get_minecraft_path(self.server, "working_directory")).resolve()

    def _roots(self) -> dict:
        try:
            return MCDRAdapter.get_root_nodes(self.server) or {}
        except Exception:
            return {}

    def _plugin_ids(self) -> set[str]:
        ids: set[str] = set()
        for method_name in ("get_all_metadata", "get_disabled_plugin_list", "get_unloaded_plugin_list"):
            try:
                value = getattr(self.server, method_name)()
                if isinstance(value, dict):
                    ids.update(str(item) for item in value.keys())
                elif isinstance(value, (list, tuple, set)):
                    ids.update(str(item) for item in value)
            except Exception:
                continue
        return ids

    def _plugin_installed(self, provider: Provider, names: set[str]) -> bool:
        plugin_ids = self._plugin_ids()
        expected = "prime_backup" if provider == "primebackup" else "quick_backup_multi"
        return ("!!pb" if provider == "primebackup" else "!!qb") in names or expected in plugin_ids

    def _prime_config_root(self) -> Path | None:
        data = self._prime_config_data()
        if data is not None:
            raw = data.get("storage_root") or data.get("storage_path") or data.get("storage_dir")
            if isinstance(raw, str) and raw.strip():
                value = Path(raw.strip())
                config_path = self.working_dir() / "config" / "prime_backup" / "config.json"
                if not config_path.is_file():
                    config_path = Path("config") / "prime_backup" / "config.json"
                if not value.is_absolute():
                    value = config_path.parent.parent.parent / value
                return value.resolve()
        default = self.working_dir() / "pb_files"
        return default if default.exists() else None

    def _prime_config_data(self) -> dict[str, Any] | None:
        for path in (self.working_dir() / "config" / "prime_backup" / "config.json", Path("config") / "prime_backup" / "config.json"):
            try:
                if not path.is_file():
                    continue
                data = json.loads(path.read_text(encoding="utf-8-sig"))
                if isinstance(data, dict):
                    return data
            except (OSError, ValueError, TypeError):
                continue
        return None

    def _prime_config_path(self) -> Path:
        preferred = self.working_dir() / "config" / "prime_backup" / "config.json"
        if preferred.is_file():
            return preferred
        return Path("config") / "prime_backup" / "config.json"

    def prime_setup(self) -> dict[str, Any]:
        data = self._prime_config_data() or {}
        raw_root = data.get("storage_root") or data.get("storage_path") or data.get("storage_dir") or "./pb_files"
        backup = data.get("backup") if isinstance(data.get("backup"), dict) else {}
        targets = backup.get("targets") if isinstance(backup.get("targets"), list) else ["world"]
        return {"enabled": self._config_enabled("primebackup"), "storage_root": str(raw_root), "targets": [str(item) for item in targets if str(item).strip()], "config_path": str(self._prime_config_path())}

    def configure_prime(self, enabled: bool, storage_root: str, targets: list[str]) -> dict[str, Any]:
        storage_root = str(storage_root or "./pb_files").strip()
        if not storage_root or any(char in storage_root for char in "\r\n") or len(storage_root) > 500:
            raise ValueError("PrimeBackup 存储目录无效")
        normalized_targets = [str(item).strip() for item in targets if str(item).strip()]
        if not normalized_targets or any("\r" in item or "\n" in item or len(item) > 255 for item in normalized_targets):
            raise ValueError("至少需要一个有效的备份目标")
        path = self._prime_config_path()
        data = self._prime_config_data() or {}
        enable_key = "enabled" if "enabled" in data else "enable"
        data[enable_key] = bool(enabled)
        data["storage_root"] = storage_root
        backup = data.get("backup") if isinstance(data.get("backup"), dict) else {}
        backup["targets"] = normalized_targets
        data["backup"] = backup
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return {"status": "success", "config_path": str(path), "message": "PrimeBackup 配置已保存"}

    def _config_enabled(self, provider: Provider) -> bool:
        if provider == "primebackup":
            data = self._prime_config_data()
        else:
            data = None
            for path in (self.working_dir() / "config" / "quick_backup_multi" / "config.json", Path("config") / "quick_backup_multi" / "config.json"):
                try:
                    if path.is_file():
                        loaded = json.loads(path.read_text(encoding="utf-8-sig"))
                        if isinstance(loaded, dict):
                            data = loaded
                            break
                except (OSError, ValueError, TypeError):
                    continue
        if not data:
            return True
        value = data.get("enabled", data.get("enable", True))
        return value is not False

    def _quick_config_data(self) -> dict[str, Any] | None:
        for path in (Path("config") / "QuickBackupM.json", self.working_dir() / "config" / "QuickBackupM.json"):
            try:
                if path.is_file():
                    data = json.loads(path.read_text(encoding="utf-8-sig"))
                    if isinstance(data, dict):
                        return data
            except (OSError, ValueError, TypeError):
                continue
        return None

    def _quick_backup_root(self) -> Path:
        config = self._quick_config_data() or {}
        raw = config.get("backup_path") or "./qb_multi"
        candidate = Path(str(raw))
        if not candidate.is_absolute():
            candidates = [Path.cwd() / candidate, self.working_dir() / candidate]
        else:
            candidates = [candidate]
        for path in candidates:
            if path.is_dir():
                return path.resolve()
        return candidates[0].resolve()

    @staticmethod
    def _directory_size(path: Path) -> int:
        total = 0
        try:
            for item in path.rglob("*"):
                if item.is_file():
                    total += item.stat().st_size
        except OSError:
            return total
        return total

    def _prime_database(self) -> Path | None:
        root = self._prime_config_root()
        if not root or not root.is_dir():
            return None
        seen: set[Path] = set()
        for path in sorted(root.glob("*.db")) + sorted(root.glob("*.sqlite*")) + sorted(root.iterdir()):
            if path in seen or not path.is_file() or path.suffix in {".json", ".blob"}:
                continue
            seen.add(path)
            try:
                with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=1) as db:
                    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='backup'").fetchone():
                        return path
            except sqlite3.Error:
                continue
        return None

    @staticmethod
    def _json(value: Any, fallback: Any) -> Any:
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value) if value else fallback
        except (TypeError, ValueError):
            return fallback

    @staticmethod
    def _size_text(value: Any) -> str | None:
        if value is None:
            return None
        try:
            size = float(value)
        except (TypeError, ValueError):
            return str(value)
        units = ("B", "KiB", "MiB", "GiB", "TiB")
        idx = 0
        while abs(size) >= 1024 and idx < len(units) - 1:
            size /= 1024
            idx += 1
        return f"{int(size)} {units[idx]}" if idx == 0 else f"{size:.2f} {units[idx]}"

    @staticmethod
    def _creator_label(value: Any) -> str:
        """Return a stable display label instead of leaking command-source reprs."""
        if value is None:
            return ""
        text = re.sub(r"\s+", " ", str(value)).strip()
        if not text:
            return ""
        if re.search(r"CapturingCommandSource|CommandSource object at|command_source:\s*<", text, re.I):
            return "WebUI"
        object_match = re.fullmatch(r"<[^>]+ object at 0x[0-9a-fA-F]+>", text)
        if object_match:
            return text[1:text.find(" object at")]
        return text

    def _read_prime(self) -> tuple[list[dict[str, Any]], str | None]:
        path = self._prime_database()
        if not path:
            return [], "PrimeBackup 数据库未找到"
        try:
            with sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=1) as db:
                columns = [row[1] for row in db.execute("PRAGMA table_info(backup)").fetchall()]
                wanted = [x for x in ("id", "timestamp", "timestamp_ns_part", "creator", "comment", "targets", "tags", "file_count", "file_raw_size_sum", "file_stored_size_sum") if x in columns]
                if not wanted:
                    return [], "PrimeBackup 数据库缺少 backup 表字段"
                rows = db.execute(f"SELECT {','.join(wanted)} FROM backup ORDER BY timestamp DESC, id DESC").fetchall()
            items = []
            for row in rows:
                data = dict(zip(wanted, row))
                timestamp = data.get("timestamp")
                try:
                    timestamp = float(timestamp) if timestamp is not None else None
                    if timestamp and timestamp > 10_000_000_000:
                        timestamp /= 1000
                except (TypeError, ValueError):
                    timestamp = None
                if timestamp is not None and data.get("timestamp_ns_part") is not None:
                    try:
                        timestamp += float(data["timestamp_ns_part"]) / 1_000_000_000
                    except (TypeError, ValueError):
                        pass
                raw_size, stored_size = data.get("file_raw_size_sum"), data.get("file_stored_size_sum")
                items.append({"provider": "primebackup", "id": str(data.get("id")), "slot": None, "comment": str(data.get("comment") or ""), "created_at": timestamp, "creator": self._creator_label(data.get("creator")), "size": self._size_text(stored_size), "raw_size": raw_size, "stored_size": stored_size, "file_count": data.get("file_count"), "targets": self._json(data.get("targets"), []), "tags": self._json(data.get("tags"), {})})
            return items, None
        except (sqlite3.Error, OSError) as exc:
            return [], f"无法读取 PrimeBackup 数据库: {exc}"

    def _read_quick(self) -> tuple[list[dict[str, Any]], str | None]:
        root = self._quick_backup_root()
        if not root.is_dir():
            return [], "QuickBackupM 备份目录未找到"
        items = []
        for path in sorted(root.glob("slot*/info.json"), key=lambda p: p.parent.name):
            try:
                slot = path.parent.name.removeprefix("slot")
                if not slot.isdigit() or path.resolve().parent.parent != root.resolve():
                    continue
                info = json.loads(path.read_text(encoding="utf-8-sig"))
                if not isinstance(info, dict):
                    continue
                created = info.get("time_stamp", info.get("time", info.get("timestamp", info.get("created_at"))))
                try:
                    created = float(created) if created is not None else None
                    if created and created > 10_000_000_000:
                        created /= 1000
                except (TypeError, ValueError):
                    created = None
                size = info.get("size", info.get("total_size"))
                if size is None:
                    size = self._directory_size(path.parent)
                items.append({"provider": "quickbackupm", "id": slot, "slot": slot, "comment": str(info.get("comment", info.get("name", "")) or ""), "created_at": created, "creator": str(info.get("creator", "") or ""), "size": self._size_text(size), "raw_size": info.get("raw_size", size), "stored_size": info.get("stored_size", size), "format": info.get("format", info.get("backup_format")), "targets": info.get("targets", []), "tags": info.get("tags", {})})
            except (OSError, ValueError, TypeError):
                continue
        return items, None

    def providers(self) -> list[dict[str, Any]]:
        roots = self._roots()
        names = set(roots.keys()) if isinstance(roots, dict) else set()
        prime_db = self._prime_database()
        quick_dir = self._quick_backup_root()
        prime_installed = self._plugin_installed("primebackup", names)
        quick_installed = self._plugin_installed("quickbackupm", names)
        prime_enabled = self._config_enabled("primebackup")
        quick_enabled = self._config_enabled("quickbackupm")
        return [
            # 存储目录只能证明历史数据存在，不能证明插件已安装；安装状态以 MCDR 命令是否注册为准。
            {"id": "primebackup", "name": "PrimeBackup", "installed": prime_installed, "enabled": prime_enabled, "available": prime_installed and prime_enabled, "state": "missing" if not prime_installed else "ready" if prime_enabled else "disabled", "guide_url": "https://tisunion.github.io/PrimeBackup/zh/quick_start/", "storage": str(prime_db) if prime_db else None},
            {"id": "quickbackupm", "name": "QuickBackupM", "installed": quick_installed, "enabled": quick_enabled, "available": quick_installed and quick_enabled, "state": "missing" if not quick_installed else "ready" if quick_enabled else "disabled", "guide_url": "https://github.com/TISUnion/QuickBackupM", "storage": str(quick_dir) if quick_dir.is_dir() else None},
        ]

    def _is_provider_available(self, provider: Provider) -> bool:
        return next((bool(item["available"]) for item in self.providers() if item["id"] == provider), False)

    @staticmethod
    def _clean_output(value: Any) -> str:
        text = str(value or "")
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
        text = re.sub(r"§.", "", text)
        return text.replace("\r", "")

    async def _command(self, command: str) -> dict[str, Any]:
        result = await self.server_service.send_command(command)
        feedback = self._clean_output(result.get("feedback"))
        result["feedback"] = feedback
        combined = f"{feedback}\n{result.get('message') or ''}"
        if re.search(r"配置文件中被禁用|configuration\s+disabled|disabled\s+in\s+.*config", combined, re.I):
            result["status"], result["code"] = "error", "provider_disabled"
            result["message"] = "备份插件已安装，但在配置文件中被禁用，请启用后重载插件"
            result["guide_url"] = "https://tisunion.github.io/PrimeBackup/zh/quick_start/" if command.startswith("!!pb") else None
        elif re.search(r"未知参数|unknown\s+(?:argument|parameter)|unknown\s+option", combined, re.I):
            result["status"], result["code"] = "error", "command_unsupported"
            result["message"] = "备份插件拒绝了当前命令参数，请检查插件版本和命令格式"
        elif "未注册命令" in combined:
            result["status"] = "error"
            result["code"] = "provider_missing"
            result["message"] = "对应备份插件未安装或命令未注册"
        return result

    @staticmethod
    def _parse_prime(text: str) -> list[dict[str, Any]]:
        items = []
        pattern = re.compile(r"\[#(?P<id>\d+)\]\s+(?P<size>\S+)\s+(?P<created>\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})(?::\s*(?P<comment>.*))?$")
        for line in text.splitlines():
            line = line.strip()
            match = pattern.search(line)
            if not match:
                continue
            items.append({
                "id": match.group("id"),
                "slot": None,
                "size": match.group("size"),
                "created_at": match.group("created"),
                "comment": (match.group("comment") or "").strip(),
            })
        return items

    @staticmethod
    def _parse_quick(text: str) -> list[dict[str, Any]]:
        items = []
        seen: set[str] = set()
        for line in text.splitlines():
            line = line.strip()
            if not line or re.search(r"(帮助|help|槽位列表|备份列表|slot list)", line, re.I):
                continue
            match = re.search(r"(?:槽位|slot)\s*[:#]?\s*(\d+)", line, re.I)
            if not match:
                match = re.match(r"\[?\s*(\d+)\s*\]?(?:\s*[:：]|\s+)", line)
            if not match:
                continue
            slot = match.group(1)
            if slot in seen:
                continue
            seen.add(slot)
            tail = line[match.end():].strip(" :：-\t")
            items.append({"id": slot, "slot": slot, "size": None, "created_at": None, "comment": tail})
        return items

    async def list_backups(self, provider: Provider, page: int = 1, per_page: int = 20) -> dict[str, Any]:
        page = max(1, int(page))
        per_page = max(1, min(100, int(per_page)))
        if provider == "primebackup":
            items, error = self._read_prime()
        elif provider == "quickbackupm":
            items, error = self._read_quick()
        else:
            raise ValueError("不支持的备份插件")
        total = len(items)
        start = (page - 1) * per_page
        return {"status": "error" if error and not items else "success", "message": error, "items": items[start:start + per_page], "total": total, "page": page, "per_page": per_page}

    async def execute(self, provider: Provider, action: str, backup_id: str | None = None, comment: str | None = None) -> dict[str, Any]:
        if provider not in {"primebackup", "quickbackupm"}:
            raise ValueError("不支持的备份插件")
        if action not in {"make", "restore", "delete", "rename", "show"}:
            raise ValueError("不支持的备份操作")
        provider_info = next((item for item in self.providers() if item["id"] == provider), None)
        name = "PrimeBackup" if provider == "primebackup" else "QuickBackupM"
        if not provider_info or not provider_info.get("installed"):
            raise ValueError(f"{name} 未安装，请先安装对应插件")
        if provider_info.get("state") == "disabled":
            return {"status": "error", "code": "provider_disabled", "message": f"{name} 已在配置文件中被禁用，请先启用配置并重载插件", "guide_url": "https://tisunion.github.io/PrimeBackup/zh/quick_start/" if provider == "primebackup" else None}
        backup_id = str(backup_id or "").strip()
        if backup_id and not re.fullmatch(r"\d+|~(?:\d+)?|latest", backup_id, re.I):
            raise ValueError("无效的备份编号")
        comment = str(comment or "").strip()
        if "\n" in comment or "\r" in comment or len(comment) > 200:
            raise ValueError("备份注释包含非法内容")
        if action == "make":
            command = f"!!{'pb' if provider == 'primebackup' else 'qb'} make"
            if comment:
                command += f" {comment}"
            return await self._command(command)
        if action in {"restore", "delete", "rename", "show"} and not backup_id:
            raise ValueError("缺少备份编号")
        if provider == "primebackup":
            commands = {
                "restore": f"!!pb back {backup_id} --confirm",
                "delete": f"!!pb delete {backup_id} --confirm",
                "rename": f"!!pb rename {backup_id} {comment}",
                "show": f"!!pb show {backup_id}",
            }
            if action == "rename" and not comment:
                raise ValueError("重命名需要注释")
            return await self._command(commands[action])
        commands = {
            "restore": f"!!qb back {backup_id}",
            "delete": f"!!qb del {backup_id}",
            "rename": f"!!qb rename {backup_id} {comment}",
            "show": "!!qb list",
        }
        if action == "rename" and not comment:
            raise ValueError("重命名需要注释")
        result = await self._command(commands[action])
        if action == "restore" and result.get("status") == "success":
            confirm = await self._command("!!qb confirm")
            result["feedback"] = "\n".join(filter(None, [result.get("feedback"), confirm.get("feedback")]))
            if confirm.get("status") != "success":
                result.update({"status": "error", "message": confirm.get("message")})
        return result
