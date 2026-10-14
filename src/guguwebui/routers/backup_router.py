from __future__ import annotations

import asyncio
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from guguwebui.dependencies.auth import get_current_admin
from guguwebui.services.operation_audit_service import record_operation
from guguwebui.structures import BusinessException
from guguwebui.structures.envelope import ApiSuccessEnvelope, PageEnvelope, page, success

router = APIRouter(prefix="/backups", tags=["backups"])


class BackupOperationRequest(BaseModel):
    provider: Literal["primebackup", "quickbackupm"]
    action: Literal["make", "restore", "delete", "rename", "show"]
    backup_id: Optional[str] = Field(default=None, max_length=32)
    comment: Optional[str] = Field(default=None, max_length=200)


class PrimeBackupSetupRequest(BaseModel):
    enabled: bool = True
    storage_root: str = Field(default="./pb_files", max_length=500)
    targets: list[str] = Field(default_factory=lambda: ["world"], max_length=32)


@router.get("/status", response_model=ApiSuccessEnvelope)
async def backup_status(request: Request, _admin: dict = Depends(get_current_admin)):
    return success({"providers": request.app.state.backup_service.providers()})


@router.get("/primebackup/setup", response_model=ApiSuccessEnvelope)
async def primebackup_setup(request: Request, _admin: dict = Depends(get_current_admin)):
    return success(request.app.state.backup_service.prime_setup())


@router.put("/primebackup/setup", response_model=ApiSuccessEnvelope)
async def save_primebackup_setup(request: Request, body: PrimeBackupSetupRequest, admin: dict = Depends(get_current_admin)):
    service = request.app.state.backup_service
    try:
        installed = next((item.get("installed") for item in service.providers() if item["id"] == "primebackup"), False)
        if not installed:
            raise ValueError("PrimeBackup 未安装，请先安装插件")
        result = service.configure_prime(body.enabled, body.storage_root, body.targets)
        reload_result = await asyncio.to_thread(request.app.state.plugin_service.reload_plugin, "prime_backup")
        if isinstance(reload_result, dict) and reload_result.get("status") != "success":
            raise BusinessException(reload_result.get("message") or "PrimeBackup 重载失败", code="primebackup_reload_failed", data={"guide_url": "https://tisunion.github.io/PrimeBackup/zh/quick_start/"})
    except ValueError as exc:
        raise BusinessException(str(exc), status_code=400, code="invalid_primebackup_setup") from exc
    record_operation(admin, operation_type="backup.primebackup_setup", summary="配置并重载 PrimeBackup", detail={"enabled": body.enabled, "storage_root": body.storage_root, "targets": body.targets})
    return success({"config_path": result.get("config_path"), "reloaded": True}, message="PrimeBackup 已配置并重载")


@router.get("", response_model=PageEnvelope)
async def list_backups(
    request: Request,
    provider: Literal["primebackup", "quickbackupm"] = Query("primebackup"),
    page_number: int = Query(1, alias="page", ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _admin: dict = Depends(get_current_admin),
):
    result = await request.app.state.backup_service.list_backups(provider, page_number, per_page)
    if result.get("status") != "success":
        raise BusinessException(result.get("message") or "备份列表获取失败", data={"providers": request.app.state.backup_service.providers()})
    return page(items=result.get("items", []), total=result.get("total", 0), offset=(page_number - 1) * per_page, limit=per_page)


@router.post("/operations", response_model=ApiSuccessEnvelope)
async def backup_operation(request: Request, body: BackupOperationRequest, admin: dict = Depends(get_current_admin)):
    try:
        result = await request.app.state.backup_service.execute(body.provider, body.action, body.backup_id, body.comment)
    except ValueError as exc:
        raise BusinessException(str(exc), status_code=400, code="invalid_backup_operation") from exc
    if result.get("status") != "success":
        raise BusinessException(
            result.get("message") or "备份操作执行失败",
            data={"feedback": result.get("feedback", ""), "guide_url": result.get("guide_url")},
            code=result.get("code") or "backup_operation_failed",
        )
    record_operation(
        admin,
        operation_type=f"backup.{body.action}",
        summary=f"{body.provider} 备份操作: {body.action}",
        detail={"provider": body.provider, "action": body.action, "backup_id": body.backup_id},
    )
    return success({"feedback": result.get("feedback", "")}, message=result.get("message") or "备份操作已执行")
