import os
import time
import uuid
import logging
import sys
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routers import tryon

_FMT = "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s"
_DATEFMT = "%H:%M:%S"

root = logging.getLogger()
root.setLevel(logging.INFO)
if not root.handlers:
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(logging.Formatter(_FMT, datefmt=_DATEFMT))
    root.addHandler(h)
else:
    for h in root.handlers:
        h.setFormatter(logging.Formatter(_FMT, datefmt=_DATEFMT))

logger = logging.getLogger("app")

app = FastAPI(title="虚拟试穿 API", version="1.0.0")


@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    """确保所有响应都有正确的 CORS 头"""
    # 处理 OPTIONS 预检请求
    if request.method == "OPTIONS":
        return JSONResponse(
            content={},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "3600",
            }
        )
    
    response = await call_next(request)
    
    # 强制设置 CORS 头
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    response.headers["Access-Control-Allow-Headers"] = "*"
    
    return response


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    request.state.req_id = req_id
    start = time.time()
    logger.info("[%s] --> %s %s  client=%s", req_id, request.method, request.url.path, request.client.host if request.client else "?")

    try:
        response = await call_next(request)
        elapsed = time.time() - start
        logger.info("[%s] <-- %s %s  status=%d  %.2fs", req_id, request.method, request.url.path, response.status_code, elapsed)
        response.headers["X-Request-Id"] = req_id
        return response
    except Exception as exc:
        elapsed = time.time() - start
        logger.exception("[%s] !!! %s %s  error=%s  %.2fs", req_id, request.method, request.url.path, exc, elapsed)
        return JSONResponse(
            status_code=500, 
            content={"detail": str(exc)}, 
            headers={
                "X-Request-Id": req_id,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*",
                "Access-Control-Allow-Headers": "*",
            }
        )


app.include_router(tryon.router, prefix="/api/tryon", tags=["tryon"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
