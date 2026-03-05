import base64
import logging
import tempfile
import os
import time
import httpx
import io
import asyncio
from pathlib import Path
from typing import Tuple
from urllib.parse import urlparse
from PIL import Image

# 确保 .env 被加载（uvicorn 不会自动加载）
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(_env_path, override=False)
    logging.getLogger(__name__).debug("已加载 .env: %s", _env_path)
except ImportError:
    pass

logger = logging.getLogger(__name__)

HF_SPACES = [
    "yisol/IDM-VTON",
    "Nymbo/Virtual-Try-On",
]

# ModelScope 在线推理服务（自定义 HTTP 接口）
MODELSCOPE_ENDPOINT = os.getenv("MODELSCOPE_ENDPOINT", "").strip()
_raw_modelscope_key = os.getenv("MODELSCOPE_API_KEY", "") or os.getenv("MODELSCOPE_SDK_TOKEN", "")
MODELSCOPE_API_KEY = (
    _raw_modelscope_key
    if (_raw_modelscope_key and not _raw_modelscope_key.startswith("your_"))
    else ""
)

# 阿里云 / DashScope 等阿里系 VTON 服务（自定义 HTTP 接口）
ALI_VTON_ENDPOINT = os.getenv("ALI_VTON_ENDPOINT", "").strip()
_raw_ali_key = os.getenv("ALI_VTON_API_KEY", "") or os.getenv("DASHSCOPE_API_KEY", "")
ALI_VTON_API_KEY = (
    _raw_ali_key if (_raw_ali_key and not _raw_ali_key.startswith("your_")) else ""
)

_raw_rapidapi = os.getenv("RAPIDAPI_KEY", "")
RAPIDAPI_KEY = _raw_rapidapi if (_raw_rapidapi and not _raw_rapidapi.startswith("your_")) else ""
RAPIDAPI_HOST = "try-on-diffusion.p.rapidapi.com"


async def _download_image(url: str) -> bytes:
    t0 = time.time()
    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "VirtualTryOn/1.0"},
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.content
        logger.info("  下载图片  url=%s  大小=%dKB  耗时=%.1fs", url[:80], len(data) // 1024, time.time() - t0)
        return data


def _image_to_base64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=92)
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _fallback_tryon(person_bytes: bytes, clothing_bytes: bytes) -> str:
    """PIL 叠加 fallback — 这只是简单贴图，非 AI 合成"""
    logger.warning("  [fallback] ⚠ 使用 PIL 简单贴图模式（非 AI 合成，效果较差）")
    logger.warning("  [fallback] 要获得真实试穿效果，需要:")
    logger.warning("  [fallback]   1. IDM-VTON HF Space 可用（检查 https://huggingface.co/spaces/yisol/IDM-VTON）")
    logger.warning("  [fallback]   2. 或配置 RAPIDAPI_KEY 使用 VTON-D 商业 API")
    logger.warning("  [fallback]   3. 或设置 HF_TOKEN 环境变量加速 HF Space 连接")

    person_img = Image.open(io.BytesIO(person_bytes)).convert("RGBA")
    clothing_img = Image.open(io.BytesIO(clothing_bytes)).convert("RGBA")

    target_w = int(person_img.width * 0.55)
    ratio = target_w / clothing_img.width
    target_h = int(clothing_img.height * ratio)
    clothing_resized = clothing_img.resize((target_w, target_h), Image.LANCZOS)

    result = person_img.copy()
    paste_x = (person_img.width - target_w) // 2
    paste_y = int(person_img.height * 0.22)
    result.paste(clothing_resized, (paste_x, paste_y), clothing_resized)
    logger.info("  [fallback] 完成  paste=(%d,%d)  size=(%d,%d)", paste_x, paste_y, target_w, target_h)
    return _image_to_base64(result)


async def _try_modelscope_vton(person_bytes: bytes, clothing_bytes: bytes) -> str:
    """
    调用自建的 ModelScope 虚拟试穿服务。

    约定（可按自己后端实际服务调整）:
    - URL: MODELSCOPE_ENDPOINT
    - Auth: 请求头携带 Authorization: Bearer MODELSCOPE_API_KEY
    - 请求体(JSON):
        {
          "person_image_base64": "<base64>",
          "clothing_image_base64": "<base64>"
        }
    - 响应:
        1) JSON: {"result_image_base64": "<base64>"} 或 {"image": "<base64>"}
        2) 或直接返回 JPEG/PNG 二进制
    """
    if not MODELSCOPE_ENDPOINT:
        raise RuntimeError("MODELSCOPE_ENDPOINT 未配置")

    logger.info("  [ModelScope] 调用 ModelScope VTON 服务: %s", MODELSCOPE_ENDPOINT)
    t0 = time.time()

    headers = {"User-Agent": "VirtualTryOn/1.0", "Content-Type": "application/json"}
    if MODELSCOPE_API_KEY:
        headers["Authorization"] = f"Bearer {MODELSCOPE_API_KEY}"

    payload = {
        "person_image_base64": base64.b64encode(person_bytes).decode("utf-8"),
        "clothing_image_base64": base64.b64encode(clothing_bytes).decode("utf-8"),
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(MODELSCOPE_ENDPOINT, json=payload, headers=headers)
    elapsed = time.time() - t0
    logger.info(
        "  [ModelScope] 响应  status=%d  大小=%dKB  耗时=%.1fs",
        resp.status_code,
        len(resp.content) // 1024,
        elapsed,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"ModelScope VTON 返回 {resp.status_code}: {resp.text[:200]}")

    content_type = resp.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        data = resp.json()
        b64 = data.get("result_image_base64") or data.get("image") or data.get("data")
        if not b64:
            raise RuntimeError("ModelScope VTON JSON 响应中缺少 base64 字段")
        return b64

    # 非 JSON，按图片二进制处理
    img = Image.open(io.BytesIO(resp.content))
    return _image_to_base64(img)


async def _try_ali_vton(person_image_url: str, clothing_image_url: str) -> str:
    """
    按照阿里云百炼 OutfitAnyone / AI试衣-基础版文档调用 DashScope 接口:
    https://help.aliyun.com/zh/model-studio/outfitanyone-api

    步骤:
    1) POST 创建任务到:
       ALI_VTON_ENDPOINT (推荐配置为
       https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis/)
    2) 从返回的 output.task_id 轮询:
       GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}
    3) 当 task_status == SUCCEEDED 时，从 output.image_url 下载图片并转为 base64。
    """
    if not ALI_VTON_ENDPOINT:
        raise RuntimeError("ALI_VTON_ENDPOINT 未配置")
    if not ALI_VTON_API_KEY:
        raise RuntimeError("ALI_VTON_API_KEY/DASHSCOPE_API_KEY 未配置")

    logger.info("  [Ali] 调用阿里 VTON 服务: %s", ALI_VTON_ENDPOINT)

    headers = {
        "User-Agent": "VirtualTryOn/1.0",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {ALI_VTON_API_KEY}",
        "X-DashScope-Async": "enable",
    }

    payload = {
        "model": "aitryon",
        "input": {
            "person_image_url": person_image_url,
            # 这里默认把服装图作为上装试穿，如需支持下装或组合，可根据前端参数扩展
            "top_garment_url": clothing_image_url,
        },
        "parameters": {
            "resolution": -1,
            "restore_face": True,
        },
    }

    t0 = time.time()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(ALI_VTON_ENDPOINT, json=payload, headers=headers)
    elapsed = time.time() - t0
    logger.info(
        "  [Ali] 创建任务响应  status=%d  大小=%dKB  耗时=%.1fs",
        resp.status_code,
        len(resp.content) // 1024,
        elapsed,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"Ali VTON 创建任务失败 {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    output = data.get("output") or {}
    task_id = output.get("task_id")
    if not task_id:
        raise RuntimeError(f"Ali VTON 响应缺少 task_id: {data}")

    # 解析出 DashScope host，用于拼接 tasks 查询地址
    parsed = urlparse(ALI_VTON_ENDPOINT)
    base = f"{parsed.scheme}://{parsed.netloc}"
    task_url = f"{base}/api/v1/tasks/{task_id}"

    logger.info("  [Ali] 开始轮询任务结果 task_id=%s  url=%s", task_id, task_url)

    # 轮询任务状态，最多约 2 分钟
    max_wait_sec = 120
    interval_sec = 3
    deadline = time.time() + max_wait_sec

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            if time.time() > deadline:
                raise RuntimeError(
                    f"Ali VTON 轮询超时 ({max_wait_sec}s)，task_id={task_id}"
                )

            r = await client.get(
                task_url,
                headers={
                    "Authorization": f"Bearer {ALI_VTON_API_KEY}",
                },
            )
            if r.status_code != 200:
                raise RuntimeError(
                    f"Ali VTON 查询任务失败 {r.status_code}: {r.text[:200]}"
                )

            result = r.json()
            out = result.get("output") or {}
            status = out.get("task_status")
            logger.info("  [Ali] 任务状态 task_id=%s status=%s", task_id, status)

            if status == "SUCCEEDED":
                image_url = out.get("image_url")
                if not image_url:
                    raise RuntimeError(
                        f"Ali VTON 成功但缺少 image_url: {result}"
                    )

                logger.info("  [Ali] 下载结果图片: %s", image_url)
                img_bytes = await _download_image(image_url)
                img = Image.open(io.BytesIO(img_bytes))
                return _image_to_base64(img)

            if status in {"FAILED", "CANCELED", "UNKNOWN"}:
                code = out.get("code")
                message = out.get("message")
                raise RuntimeError(
                    f"Ali VTON 任务失败 status={status} code={code} message={message}"
                )

            # PENDING / RUNNING 等，等待一会继续查询
            await asyncio.sleep(interval_sec)


def _try_idm_vton(person_path: str, clothing_path: str) -> str:
    """调用 IDM-VTON HF Space"""
    from gradio_client import Client, handle_file

    space_id = HF_SPACES[0]
    logger.info("  [IDM-VTON] 连接 HF Space: %s", space_id)
    t0 = time.time()

    hf_token = os.getenv("HF_TOKEN", None)
    if hf_token and not hf_token.startswith("your_"):
        logger.info("  [IDM-VTON] HF_TOKEN 已配置 (前缀: %s...)", hf_token[:8])
    else:
        logger.warning("  [IDM-VTON] HF_TOKEN 未设置或为占位符，可能连接较慢或被限流")
        hf_token = None

    # gradio_client 1.3.x 用 hf_token=, 更新版本用 token=
    try:
        client = Client(space_id, hf_token=hf_token)
    except TypeError:
        try:
            client = Client(space_id, token=hf_token)
        except TypeError:
            client = Client(space_id)
    conn_time = time.time() - t0
    logger.info("  [IDM-VTON] 连接成功  耗时=%.1fs", conn_time)

    t1 = time.time()
    result = client.predict(
        dict={"background": handle_file(person_path), "layers": [], "composite": None},
        garm_img=handle_file(clothing_path),
        garment_des="clothing",
        is_checked=True,
        is_checked_crop=False,
        denoise_steps=30,
        seed=42,
        api_name="/tryon",
    )
    infer_time = time.time() - t1
    logger.info("  [IDM-VTON] 推理完成  耗时=%.1fs  result_type=%s", infer_time, type(result).__name__)

    if isinstance(result, (list, tuple)):
        output_path = result[0]
    else:
        output_path = result

    logger.info("  [IDM-VTON] 输出路径: %s", output_path)
    output_img = Image.open(output_path)
    return _image_to_base64(output_img)


async def _try_rapidapi_vton(person_bytes: bytes, clothing_bytes: bytes) -> str:
    """调用 RapidAPI VTON-D（Texel.Moda）— 商业 API，效果好"""
    if not RAPIDAPI_KEY:
        raise RuntimeError("RAPIDAPI_KEY 未配置，跳过。配置方法: 在 backend/.env 添加 RAPIDAPI_KEY=你的key")

    logger.info("  [VTON-D] 调用 RapidAPI try-on-diffusion")
    t0 = time.time()
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"https://{RAPIDAPI_HOST}/try-on-file",
            headers={
                "x-rapidapi-host": RAPIDAPI_HOST,
                "x-rapidapi-key": RAPIDAPI_KEY,
            },
            files={
                "avatar_image": ("person.jpg", person_bytes, "image/jpeg"),
                "clothing_image": ("clothing.jpg", clothing_bytes, "image/jpeg"),
            },
        )
    elapsed = time.time() - t0
    logger.info("  [VTON-D] 响应  status=%d  大小=%dKB  耗时=%.1fs", resp.status_code, len(resp.content) // 1024, elapsed)

    if resp.status_code != 200:
        raise RuntimeError(f"VTON-D API 返回 {resp.status_code}: {resp.text[:200]}")

    img = Image.open(io.BytesIO(resp.content))
    return _image_to_base64(img)


def _diagnose_hf_error(e: Exception) -> str:
    """分析 HF Space 失败原因，给出排查建议"""
    err_str = str(e).lower()
    if "could not connect" in err_str or "connection" in err_str:
        return "网络无法连接 HF Space。检查: 1) 网络是否能访问 huggingface.co  2) 是否需要代理 (设置 HTTPS_PROXY)"
    if "queue" in err_str or "exceeded" in err_str:
        return "HF Space 排队超时/GPU 配额用尽。这是免费 Space 的限制，稍后重试或配置 RAPIDAPI_KEY 使用商业 API"
    if "no api" in err_str or "api_name" in err_str:
        return "HF Space API 接口变更。Space 可能已更新，需要检查最新 API 参数"
    if "timeout" in err_str:
        return "请求超时。HF Space 推理可能需要 1-3 分钟，或 Space 正在冷启动"
    if "rate" in err_str or "limit" in err_str:
        return "被限流。设置 HF_TOKEN 环境变量可提高限额"
    return f"未知错误: {type(e).__name__}: {str(e)[:150]}"


async def process_tryon(person_image_url: str, clothing_image_url: str) -> Tuple[str, str]:
    """
    虚拟试穿合成 — 多级降级策略:
    1. ModelScope 在线服务 (自建 HTTP 接口)
    2. 阿里云 / DashScope 等阿里系服务 (自建 HTTP 接口)
    3. IDM-VTON HF Space (免费 AI 合成)
    4. RapidAPI VTON-D (商业 API，需配置 RAPIDAPI_KEY，作为额外备选)
    5. PIL 叠加 fallback (简单贴图，效果差)

    返回 (base64_image, method_name)
    """
    logger.info("=" * 60)
    logger.info("开始试穿合成")
    logger.info("=" * 60)

    t_start = time.time()
    person_bytes = await _download_image(person_image_url)
    clothing_bytes = await _download_image(clothing_image_url)
    logger.info("  图片下载完成  person=%dKB  clothing=%dKB", len(person_bytes) // 1024, len(clothing_bytes) // 1024)

    person_img = Image.open(io.BytesIO(person_bytes)).convert("RGB")
    clothing_img = Image.open(io.BytesIO(clothing_bytes)).convert("RGB")
    logger.info("  图片尺寸  person=%s  clothing=%s", person_img.size, clothing_img.size)

    tmp_dir = tempfile.mkdtemp()
    person_path = os.path.join(tmp_dir, "person.jpg")
    clothing_path = os.path.join(tmp_dir, "clothing.jpg")
    person_img.save(person_path, "JPEG", quality=95)
    clothing_img.save(clothing_path, "JPEG", quality=95)

    # --- 策略 1: ModelScope ---
    if MODELSCOPE_ENDPOINT:
        try:
            logger.info("  [策略1/5] 尝试 ModelScope 在线服务...")
            result = await _try_modelscope_vton(person_bytes, clothing_bytes)
            logger.info("=" * 60)
            logger.info("试穿完成 ✓  方法=ModelScope  总耗时=%.1fs", time.time() - t_start)
            logger.info("=" * 60)
            return result, "ModelScope"
        except Exception as e:
            logger.warning(
                "  [策略1/5] ModelScope 失败: %s: %s",
                type(e).__name__,
                str(e)[:200],
            )
    else:
        logger.info("  [策略1/5] 跳过 ModelScope (MODELSCOPE_ENDPOINT 未配置)")

    # --- 策略 2: 阿里系 VTON ---
    if ALI_VTON_ENDPOINT:
        try:
            logger.info("  [策略2/5] 尝试阿里 VTON 服务...")
            # 阿里 DashScope 接口直接使用公网图片 URL，不需要本地临时文件
            result = await _try_ali_vton(person_image_url, clothing_image_url)
            logger.info("=" * 60)
            logger.info("试穿完成 ✓  方法=Ali-VTON  总耗时=%.1fs", time.time() - t_start)
            logger.info("=" * 60)
            return result, "Ali-VTON"
        except Exception as e:
            logger.warning(
                "  [策略2/5] Ali VTON 失败: %s: %s",
                type(e).__name__,
                str(e)[:200],
            )
    else:
        logger.info("  [策略2/5] 跳过 Ali VTON (ALI_VTON_ENDPOINT 未配置)")

    # --- 策略 3: IDM-VTON (HuggingFace) ---
    try:
        logger.info("  [策略3/5] 尝试 IDM-VTON HF Space...")
        result = _try_idm_vton(person_path, clothing_path)
        logger.info("=" * 60)
        logger.info("试穿完成 ✓  方法=IDM-VTON  总耗时=%.1fs", time.time() - t_start)
        logger.info("=" * 60)
        return result, "IDM-VTON"
    except Exception as e:
        diagnosis = _diagnose_hf_error(e)
        logger.warning("  [策略3/5] IDM-VTON 失败!")
        logger.warning("  [策略3/5] 原因: %s", diagnosis)

    # --- 策略 4: RapidAPI VTON-D (额外备选) ---
    if RAPIDAPI_KEY:
        try:
            logger.info("  [策略4/5] 尝试 RapidAPI VTON-D...")
            result = await _try_rapidapi_vton(person_bytes, clothing_bytes)
            logger.info("=" * 60)
            logger.info("试穿完成 ✓  方法=VTON-D  总耗时=%.1fs", time.time() - t_start)
            logger.info("=" * 60)
            return result, "VTON-D"
        except Exception as e:
            logger.warning(
                "  [策略4/5] VTON-D 失败: %s: %s",
                type(e).__name__,
                str(e)[:200],
            )
    else:
        logger.info("  [策略4/5] 跳过 VTON-D (RAPIDAPI_KEY 未配置)")
        logger.info(
            "  [策略4/5] 获取方法: 访问 https://rapidapi.com/texelmoda-texelmoda-apis/api/try-on-diffusion 注册免费 key"
        )

    # --- 策略 5: PIL fallback ---
    logger.info("  [策略5/5] 降级到 PIL 简单贴图...")
    result = _fallback_tryon(person_bytes, clothing_bytes)
    logger.info("=" * 60)
    logger.info("试穿完成 ⚠  方法=PIL-fallback (简单贴图)  总耗时=%.1fs", time.time() - t_start)
    logger.info("=" * 60)
    return result, "PIL-fallback"
