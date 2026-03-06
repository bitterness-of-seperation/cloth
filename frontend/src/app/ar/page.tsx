"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";

// MediaPipe 模型 URL
// 使用轻量级模型以支持移动端
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
// selfie_multiclass 分割模型：可识别 background/hair/body-skin/face-skin/clothes/others
const SEG_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

// selfie_multiclass 类别索引
const SEG_BODY_SKIN = 2;
const SEG_CLOTHES = 4;
const SEG_OTHERS = 5; // 配件

const EMA_ALPHA = 0.35;
const GRID_COLS = 8;
const GRID_ROWS = 10;

interface Point { x: number; y: number; }

function lerpPt(p: Point, c: Point, a: number): Point {
  return { x: p.x + (c.x - p.x) * a, y: p.y + (c.y - p.y) * a };
}
function midPt(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function bilinear(tl: Point, tr: Point, bl: Point, br: Point, u: number, v: number): Point {
  const tx = tl.x + (tr.x - tl.x) * u, ty = tl.y + (tr.y - tl.y) * u;
  const bx = bl.x + (br.x - bl.x) * u, by = bl.y + (br.y - bl.y) * u;
  return { x: tx + (bx - tx) * v, y: ty + (by - ty) * v };
}

function drawTriTex(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement | HTMLImageElement,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  d0: Point, d1: Point, d2: Point
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y);
  ctx.closePath(); ctx.clip();
  const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(den) < 1e-6) { ctx.restore(); return; }
  const a11 = -(sy0 * (d1.x - d2.x) - sy1 * (d0.x - d2.x) + sy2 * (d0.x - d1.x)) / den;
  const a12 = (sx0 * (d1.x - d2.x) - sx1 * (d0.x - d2.x) + sx2 * (d0.x - d1.x)) / den;
  const a13 = (sx0 * (sy1 * d2.x - sy2 * d1.x) - sx1 * (sy0 * d2.x - sy2 * d0.x) + sx2 * (sy0 * d1.x - sy1 * d0.x)) / den;
  const a21 = -(sy0 * (d1.y - d2.y) - sy1 * (d0.y - d2.y) + sy2 * (d0.y - d1.y)) / den;
  const a22 = (sx0 * (d1.y - d2.y) - sx1 * (d0.y - d2.y) + sx2 * (d0.y - d1.y)) / den;
  const a23 = (sx0 * (sy1 * d2.y - sy2 * d1.y) - sx1 * (sy0 * d2.y - sy2 * d0.y) + sx2 * (sy0 * d1.y - sy1 * d0.y)) / den;
  ctx.transform(a11, a21, a12, a22, a13, a23);
  ctx.drawImage(tex, 0, 0);
  ctx.restore();
}

function drawMeshWarped(
  ctx: CanvasRenderingContext2D,
  tex: HTMLCanvasElement | HTMLImageElement,
  tl: Point, tr: Point, br: Point, bl: Point,
  cols: number, rows: number
) {
  const tw = tex instanceof HTMLCanvasElement ? tex.width : tex.naturalWidth;
  const th = tex instanceof HTMLCanvasElement ? tex.height : tex.naturalHeight;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u0 = c / cols, u1 = (c + 1) / cols;
      const v0 = r / rows, v1 = (r + 1) / rows;
      const p00 = bilinear(tl, tr, bl, br, u0, v0);
      const p10 = bilinear(tl, tr, bl, br, u1, v0);
      const p01 = bilinear(tl, tr, bl, br, u0, v1);
      const p11 = bilinear(tl, tr, bl, br, u1, v1);
      const sx0 = u0 * tw, sx1 = u1 * tw;
      const sy0 = v0 * th, sy1 = v1 * th;
      drawTriTex(ctx, tex, sx0, sy0, sx1, sy0, sx0, sy1, p00, p10, p01);
      drawTriTex(ctx, tex, sx1, sy0, sx1, sy1, sx0, sy1, p10, p11, p01);
    }
  }
}

// 从分割 mask 生成身体区域 alpha 遮罩 canvas（用于裁剪衣服）
function buildBodyMask(
  maskData: Uint8Array,
  maskW: number, maskH: number,
  canvasW: number, canvasH: number
): HTMLCanvasElement {
  const offscreen = document.createElement("canvas");
  offscreen.width = maskW;
  offscreen.height = maskH;
  const ctx = offscreen.getContext("2d")!;
  const imgData = ctx.createImageData(maskW, maskH);
  const d = imgData.data;

  for (let i = 0; i < maskData.length; i++) {
    const cat = maskData[i];
    // 身体皮肤 + 衣服 + 配件 = 可穿衣区域
    const isBody = cat === SEG_BODY_SKIN || cat === SEG_CLOTHES || cat === SEG_OTHERS;
    d[i * 4] = 255;
    d[i * 4 + 1] = 255;
    d[i * 4 + 2] = 255;
    d[i * 4 + 3] = isBody ? 255 : 0;
  }
  ctx.putImageData(imgData, 0, 0);

  // 缩放到实际 canvas 尺寸
  const scaled = document.createElement("canvas");
  scaled.width = canvasW;
  scaled.height = canvasH;
  const sCtx = scaled.getContext("2d")!;
  sCtx.drawImage(offscreen, 0, 0, canvasW, canvasH);
  return scaled;
}

// 去白色/浅色背景
function removeWhiteBg(img: HTMLImageElement, threshold = 230): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const { width: w, height: h } = c;
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > threshold && g > threshold && b > threshold) {
      d[i + 3] = 0;
    } else if (r > threshold - 40 && g > threshold - 40 && b > threshold - 40) {
      const avg = (r + g + b) / 3;
      d[i + 3] = Math.round(d[i + 3] * Math.max(0, (avg - (threshold - 40)) / 40 - 1) * -1 + d[i + 3]);
    }
  }
  // 边缘羽化
  const feather = 14;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.min(y, h - 1 - y, x, w - 1 - x);
      if (dist < feather) {
        const idx = (y * w + x) * 4;
        d[idx + 3] = Math.round(d[idx + 3] * (dist / feather));
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

type SmoothedPose = {
  ls: Point; rs: Point; lh: Point; rh: Point;
  le: Point; re: Point; neck: Point; midHip: Point;
};

type PoseLandmarker = Awaited<ReturnType<typeof import("@mediapipe/tasks-vision").PoseLandmarker.createFromOptions>>;
type ImageSegmenter = Awaited<ReturnType<typeof import("@mediapipe/tasks-vision").ImageSegmenter.createFromOptions>>;

export default function ARPage() {
  const { user } = useAuthStore();
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clothingTexRef = useRef<HTMLCanvasElement | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const imageSegmenterRef = useRef<ImageSegmenter | null>(null);
  const animationRef = useRef<number>(0);
  const smoothedRef = useRef<SmoothedPose | null>(null);
  // 最新的身体 mask（每帧更新）
  const bodyMaskRef = useRef<HTMLCanvasElement | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [clothingPreview, setClothingPreview] = useState<string>("");
  const [poseReady, setPoseReady] = useState(false);
  const [segReady, setSegReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [removeBg, setRemoveBg] = useState(true);
  const [useBodyMask, setUseBodyMask] = useState(true);
  const [isBrowser, setIsBrowser] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileChecked, setMobileChecked] = useState(false);

  const clothingInputRef = useRef<HTMLInputElement>(null);
  const fpsCountRef = useRef({ frames: 0, lastTime: performance.now() });

  // 检测浏览器环境和设备类型
  useEffect(() => {
    setIsBrowser(true);
    
    // 检测移动设备
    if (typeof window !== 'undefined') {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      setIsMobile(mobile);
      setMobileChecked(true);
      
      if (mobile) {
        toast.error("移动端暂不支持 AR 功能", {
          description: "AR 实时试穿需要较高的设备性能，建议使用电脑访问。您可以使用「虚拟试穿」功能。",
          duration: 8000,
        });
      }
    }
  }, []);

  const drawFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const pose = poseLandmarkerRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animationRef.current = requestAnimationFrame(drawFrame);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) { animationRef.current = requestAnimationFrame(drawFrame); return; }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const W = canvas.width, H = canvas.height;

    // 绘制镜像摄像头
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -W, 0, W, H);
    ctx.restore();

    const clothTex = clothingTexRef.current;

    if (pose && clothTex) {
      try {
        const now = performance.now();

        // 分割检测（每帧）
        const seg = imageSegmenterRef.current;
        if (seg && useBodyMask) {
          const segResult = seg.segmentForVideo(video, now);
          const catMask = segResult.categoryMask;
          if (catMask) {
            const maskArr = catMask.getAsUint8Array();
            const mW = catMask.width, mH = catMask.height;
            bodyMaskRef.current = buildBodyMask(maskArr, mW, mH, W, H);
            catMask.close();
          }
        }

        // 姿态检测
        const poseResult = pose.detectForVideo(video, now);
        const poses = poseResult.landmarks;
        if (poses && poses.length > 0 && poses[0].length >= 25) {
          const lm = poses[0];
          const mirror = (idx: number): Point => ({
            x: (1 - lm[idx].x) * W,
            y: lm[idx].y * H,
          });

          const rawLs = mirror(11), rawRs = mirror(12);
          const rawLh = mirror(23), rawRh = mirror(24);
          const rawLe = mirror(13), rawRe = mirror(14);
          const rawNeck = midPt(mirror(11), mirror(12));
          const rawMidHip = midPt(mirror(23), mirror(24));

          const prev = smoothedRef.current;
          const a = EMA_ALPHA;
          const ls = prev ? lerpPt(prev.ls, rawLs, a) : rawLs;
          const rs = prev ? lerpPt(prev.rs, rawRs, a) : rawRs;
          const lh = prev ? lerpPt(prev.lh, rawLh, a) : rawLh;
          const rh = prev ? lerpPt(prev.rh, rawRh, a) : rawRh;
          const le = prev ? lerpPt(prev.le, rawLe, a) : rawLe;
          const re = prev ? lerpPt(prev.re, rawRe, a) : rawRe;
          const neck = prev ? lerpPt(prev.neck, rawNeck, a) : rawNeck;
          const midHip = prev ? lerpPt(prev.midHip, rawMidHip, a) : rawMidHip;
          smoothedRef.current = { ls, rs, lh, rh, le, re, neck, midHip };

          const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y);
          const torsoH = Math.hypot(midHip.x - neck.x, midHip.y - neck.y);
          if (shoulderW < 20 || torsoH < 20) {
            animationRef.current = requestAnimationFrame(drawFrame);
            return;
          }

          const shoulderAngle = Math.atan2(rs.y - ls.y, rs.x - ls.x);
          const padX = shoulderW * 0.22;
          const padTop = torsoH * 0.12;
          const padBot = torsoH * 0.08;
          const sleeveExt = shoulderW * 0.20;

          const topLeft: Point = {
            x: ls.x - padX - sleeveExt * Math.cos(shoulderAngle),
            y: ls.y - padTop - sleeveExt * Math.sin(shoulderAngle),
          };
          const topRight: Point = {
            x: rs.x + padX + sleeveExt * Math.cos(shoulderAngle),
            y: rs.y - padTop + sleeveExt * Math.sin(shoulderAngle),
          };
          const hipAngle = Math.atan2(rh.y - lh.y, rh.x - lh.x);
          const hipW = Math.hypot(rh.x - lh.x, rh.y - lh.y);
          const hipPad = (hipW * 0.12) / 2;
          const bottomLeft: Point = {
            x: lh.x - padX * 0.4 + hipPad * Math.cos(hipAngle),
            y: lh.y + padBot + hipPad * Math.sin(hipAngle),
          };
          const bottomRight: Point = {
            x: rh.x + padX * 0.4 - hipPad * Math.cos(hipAngle),
            y: rh.y + padBot - hipPad * Math.sin(hipAngle),
          };

          // 先在离屏 canvas 上绘制变形后的衣服
          const offCloth = document.createElement("canvas");
          offCloth.width = W; offCloth.height = H;
          const offCtx = offCloth.getContext("2d")!;
          offCtx.globalAlpha = 0.93;
          drawMeshWarped(offCtx, clothTex, topLeft, topRight, bottomRight, bottomLeft, GRID_COLS, GRID_ROWS);

          // 如果有身体 mask，用它裁剪衣服（衣服只显示在身体区域）
          if (useBodyMask && bodyMaskRef.current) {
            offCtx.globalCompositeOperation = "destination-in";
            offCtx.globalAlpha = 1;
            // 稍微扩展 mask（避免边缘太紧）
            offCtx.filter = "blur(3px)";
            offCtx.drawImage(bodyMaskRef.current, 0, 0);
            offCtx.filter = "none";
            offCtx.globalCompositeOperation = "source-over";
          }

          // 将裁剪后的衣服合成到主 canvas
          ctx.drawImage(offCloth, 0, 0);
        }
      } catch {
        // skip frame
      }
    }

    fpsCountRef.current.frames++;
    const now2 = performance.now();
    if (now2 - fpsCountRef.current.lastTime >= 1000) {
      setFps(fpsCountRef.current.frames);
      fpsCountRef.current.frames = 0;
      fpsCountRef.current.lastTime = now2;
    }
    animationRef.current = requestAnimationFrame(drawFrame);
  }, [useBodyMask]);

  const startCamera = async () => {
    try {
      // 只在客户端环境检查
      if (!isBrowser) {
        return;
      }

      // 移动端不支持
      if (isMobile) {
        toast.error("移动端暂不支持 AR 功能", {
          description: "请使用电脑访问，或使用「虚拟试穿」功能",
          duration: 5000,
        });
        return;
      }
      
      // 检查是否支持 getUserMedia
      if (!navigator?.mediaDevices?.getUserMedia) {
        toast.error("浏览器不支持摄像头访问", {
          description: "请使用现代浏览器（Chrome、Firefox、Safari）",
        });
        return;
      }

      // 检查是否为安全上下文（HTTPS 或 localhost）
      const isSecureContext = window.isSecureContext;
      const isLocalhost = window.location.hostname === 'localhost' || 
                         window.location.hostname === '127.0.0.1' ||
                         window.location.hostname === '[::1]';
      
      if (!isSecureContext && !isLocalhost) {
        toast.error("需要 HTTPS 才能访问摄像头", {
          description: "请使用 HTTPS 访问，或在 Chrome 中访问 chrome://flags/#unsafely-treat-insecure-origin-as-secure 添加此域名",
          duration: 10000,
        });
        return;
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraActive(true);

      const { FilesetResolver, PoseLandmarker, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

      // 根据设备类型选择处理器
      const delegate = isMobile ? "CPU" : "GPU"; // 移动端使用 CPU，桌面端使用 GPU

      // 并行加载两个模型
      const [pose, seg] = await Promise.all([
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
        ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: SEG_MODEL_URL, delegate },
          runningMode: "VIDEO",
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        }),
      ]);

      poseLandmarkerRef.current = pose;
      imageSegmenterRef.current = seg;
      setPoseReady(true);
      setSegReady(true);
      drawFrame();
    } catch (e) {
      console.error('AR 初始化错误:', e);
      
      // 更详细的错误提示
      let errorMsg = "无法加载 AR 模型";
      let errorDesc = "请重试";
      
      if (e instanceof Error) {
        if (e.message.includes('WebAssembly')) {
          errorMsg = "模型加载失败";
          errorDesc = "您的设备可能不支持 WebAssembly，请尝试使用最新版本的 Chrome 或 Safari 浏览器";
        } else if (e.message.includes('camera') || e.message.includes('getUserMedia')) {
          errorMsg = "无法访问摄像头";
          errorDesc = "请允许浏览器访问摄像头权限";
        } else {
          errorDesc = e.message;
        }
      }
      
      toast.error(errorMsg, { description: errorDesc });
      
      // 停止摄像头
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    poseLandmarkerRef.current = null;
    imageSegmenterRef.current = null;
    smoothedRef.current = null;
    bodyMaskRef.current = null;
    setCameraActive(false);
    setPoseReady(false);
    setSegReady(false);
    setFps(0);
  };

  const takePhoto = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !user) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const filePath = `${user.id}/${Date.now()}-ar.jpg`;
      const { error } = await supabase.storage.from("tryon-results").upload(filePath, blob, { contentType: "image/jpeg" });
      if (error) { toast.error("保存失败"); return; }
      const { data: { publicUrl } } = supabase.storage.from("tryon-results").getPublicUrl(filePath);
      await supabase.from("tryon_results").insert({ user_id: user.id, person_image_url: "", result_image_url: publicUrl });
      toast.success("AR 试穿照片已保存");
    }, "image/jpeg");
  };

  const processClothing = (img: HTMLImageElement) => {
    if (removeBg) {
      clothingTexRef.current = removeWhiteBg(img);
    } else {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx2 = c.getContext("2d")!;
      ctx2.drawImage(img, 0, 0);
      // 仅做边缘羽化
      const feather = 12, w = c.width, h = c.height;
      const imgData = ctx2.getImageData(0, 0, w, h);
      const d = imgData.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dist = Math.min(y, h - 1 - y, x, w - 1 - x);
          if (dist < feather) {
            const idx = (y * w + x) * 4;
            d[idx + 3] = Math.round(d[idx + 3] * (dist / feather));
          }
        }
      }
      ctx2.putImageData(imgData, 0, 0);
      clothingTexRef.current = c;
    }
  };

  const handleClothingSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setClothingPreview(url);
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => processClothing(img);
    img.src = url;
  };

  useEffect(() => {
    if (clothingTexRef.current) {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => processClothing(img);
      img.src = clothingPreview;
    }
  }, [removeBg]);

  useEffect(() => { return () => stopCamera(); }, []);

  const modelStatus = poseReady && segReady
    ? "姿态 + 分割模型已就绪"
    : poseReady
    ? "姿态模型已就绪，分割加载中..."
    : "模型加载中...";

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold">AR 实时试穿</h1>
        <p className="text-muted-foreground mt-2">
          {mobileChecked && isMobile 
            ? "移动端暂不支持 AR 功能，请使用电脑访问或使用「虚拟试穿」"
            : "打开摄像头，选择服装，实时查看穿搭效果"
          }
        </p>
      </div>

      {mobileChecked && isMobile && (
        <Card className="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-semibold mb-1">移动端不支持</h3>
                <p className="text-sm text-muted-foreground">
                  AR 实时试穿需要加载大型 AI 模型，移动设备性能不足。
                  建议使用电脑访问，或使用「虚拟试穿」功能获得更好的体验。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardContent className="p-2">
              <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3]">
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
                  playsInline muted
                  style={{ display: cameraActive ? "none" : "block" }}
                />
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-cover"
                  style={{ display: cameraActive ? "block" : "none" }}
                />
                {!cameraActive && (
                  <div className="absolute inset-0 flex items-center justify-center text-white">
                    <p>摄像头未开启</p>
                  </div>
                )}
                {cameraActive && (
                  <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded space-y-0.5">
                    <div>{fps} FPS | {GRID_COLS}×{GRID_ROWS} mesh</div>
                    {segReady && useBodyMask && <div className="text-green-400">身体分割 ON</div>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 mt-4 justify-center">
            {!cameraActive ? (
              <Button size="lg" onClick={startCamera}>开启摄像头</Button>
            ) : (
              <>
                <Button size="lg" variant="destructive" onClick={stopCamera}>关闭摄像头</Button>
                <Button size="lg" onClick={takePhoto}>拍照保存</Button>
              </>
            )}
          </div>

          {cameraActive && (!poseReady || !segReady) && (
            <p className="text-center text-sm text-muted-foreground mt-2 animate-pulse">
              {modelStatus}
            </p>
          )}
          {cameraActive && poseReady && !clothingPreview && (
            <p className="text-center text-sm text-amber-600 mt-2">
              请先选择要试穿的服装图片
            </p>
          )}
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>选择服装</CardTitle>
              <CardDescription>建议使用纯色/白色背景的平铺服装图</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary transition-colors min-h-[200px] flex items-center justify-center"
                onClick={() => clothingInputRef.current?.click()}
              >
                {clothingPreview ? (
                  <img src={clothingPreview} alt="服装" className="max-h-[200px] w-auto object-contain rounded" />
                ) : (
                  <div className="text-muted-foreground">
                    <p className="text-2xl mb-2">+</p>
                    <p className="text-sm">点击上传服装</p>
                  </div>
                )}
              </div>
              <Input ref={clothingInputRef} type="file" accept="image/*" className="hidden" onChange={handleClothingSelect} />

              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={removeBg} onChange={() => setRemoveBg(v => !v)} className="rounded" />
                  自动去白色背景
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={useBodyMask} onChange={() => setUseBodyMask(v => !v)} className="rounded" />
                  身体轮廓裁剪（更自然）
                </label>
              </div>

              <p className="text-xs text-muted-foreground">
                <strong>身体轮廓裁剪</strong>：使用 AI 分割模型识别身体区域，衣服只显示在身体上，边缘更自然。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
