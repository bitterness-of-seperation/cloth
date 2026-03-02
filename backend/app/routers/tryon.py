import logging
import time
import httpx
from fastapi import APIRouter, HTTPException, Request
from app.models.schemas import TryOnRequest, TryOnResponse
from app.services.tryon_service import process_tryon

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/generate", response_model=TryOnResponse)
async def generate_tryon(request: TryOnRequest, req: Request):
    req_id = getattr(req.state, "req_id", "?")
    logger.info("[%s] 试穿请求: person_url=%s", req_id, request.person_image_url[:120])
    logger.info("[%s] 试穿请求: clothing_url=%s", req_id, request.clothing_image_url[:120])

    start = time.time()
    try:
        result_b64, method = await process_tryon(
            request.person_image_url, request.clothing_image_url
        )
        elapsed = time.time() - start
        logger.info("[%s] 试穿完成  方法=%s  耗时=%.1fs  结果大小=%dKB", req_id, method, elapsed, len(result_b64) // 1024)
        return TryOnResponse(
            result_image_base64=result_b64,
            message=f"使用 {method} 合成完成",
            method=method,
            elapsed_sec=round(elapsed, 1),
        )
    except httpx.HTTPStatusError as e:
        elapsed = time.time() - start
        logger.error("[%s] 图片拉取失败  HTTP=%d  url=%s  耗时=%.1fs", req_id, e.response.status_code, str(e.request.url)[:120], elapsed)
        raise HTTPException(
            status_code=502,
            detail=f"无法拉取图片 (HTTP {e.response.status_code})，请确认链接可公开访问",
        )
    except Exception as e:
        elapsed = time.time() - start
        logger.exception("[%s] 试穿合成异常  耗时=%.1fs  error=%s", req_id, elapsed, e)
        raise HTTPException(
            status_code=500,
            detail=f"试穿合成失败: {str(e)}",
        )
