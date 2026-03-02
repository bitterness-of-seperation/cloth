"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
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

// 各阶段进度值和预估耗时（秒）
const STAGES = [
  { key: "upload",   label: "上传图片",         progress: 15,  estSec: 5  },
  { key: "infer",    label: "AI 模型推理中",     progress: 75,  estSec: 90 },
  { key: "save",     label: "保存结果",           progress: 95,  estSec: 3  },
  { key: "done",     label: "完成",               progress: 100, estSec: 0  },
] as const;

type StageKey = typeof STAGES[number]["key"];

export default function TryOnPage() {
  const { user } = useAuthStore();
  const supabase = createClient();

  const [personImage, setPersonImage] = useState<File | null>(null);
  const [personPreview, setPersonPreview] = useState<string>("");
  const [clothingImage, setClothingImage] = useState<File | null>(null);
  const [clothingPreview, setClothingPreview] = useState<string>("");
  const [resultUrl, setResultUrl] = useState<string>("");
  const [resultBase64, setResultBase64] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<StageKey | "">("");
  const [progress, setProgress] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [resultInfo, setResultInfo] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 平滑进度动画
  const progressAnimRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const personInputRef = useRef<HTMLInputElement>(null);
  const clothingInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (
    file: File | undefined,
    setFile: (f: File | null) => void,
    setPreview: (url: string) => void
  ) => {
    if (file) {
      setFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  const animateTo = (target: number) => {
    if (progressAnimRef.current) clearInterval(progressAnimRef.current);
    progressAnimRef.current = setInterval(() => {
      setProgress((cur) => {
        if (cur >= target) {
          clearInterval(progressAnimRef.current!);
          return target;
        }
        return cur + 1;
      });
    }, 20);
  };

  const goStage = (key: StageKey) => {
    const s = STAGES.find((x) => x.key === key)!;
    setStage(key);
    animateTo(s.progress);
  };

  const uploadToStorage = async (file: File, bucket: string): Promise<string> => {
    const ext = file.name.split(".").pop();
    const filePath = `${user!.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(filePath, file);
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  };

  const handleTryOn = async () => {
    if (!personImage || !clothingImage) { toast.error("请上传人物照片和服装图片"); return; }
    if (!user) { toast.error("请先登录"); return; }

    setLoading(true);
    setResultUrl("");
    setResultBase64("");
    setResultInfo("");
    setElapsedSec(0);
    setProgress(0);
    goStage("upload");
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);

    try {
      const [personUrl, clothingUrl] = await Promise.all([
        uploadToStorage(personImage, "person-photos"),
        uploadToStorage(clothingImage, "clothing"),
      ]);

      goStage("infer");

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await fetch(`${apiUrl}/api/tryon/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person_image_url: personUrl, clothing_image_url: clothingUrl }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.detail || `请求失败 (${response.status})`);

      const base64 = data.result_image_base64;
      if (!base64) throw new Error("未返回合成图片");

      const method = data.method || "";
      const serverElapsed = data.elapsed_sec || 0;
      setResultInfo(`合成模型: ${method} | 服务端耗时: ${serverElapsed}s`);
      setResultBase64(base64);

      goStage("save");

      const byteChars = atob(base64);
      const byteNumbers = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
      const blob = new Blob([byteNumbers], { type: "image/jpeg" });

      const filePath = `${user.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("tryon-results")
        .upload(filePath, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("tryon-results").getPublicUrl(filePath);
      setResultUrl(publicUrl);

      await supabase.from("tryon_results").insert({
        user_id: user.id,
        person_image_url: personUrl,
        result_image_url: publicUrl,
      });

      goStage("done");
      toast.success("试穿合成完成");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "未知错误";
      const isNetwork = msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed");
      toast.error("试穿失败", {
        description: isNetwork ? "无法连接后端，请确认服务已启动 (uvicorn)" : msg,
      });
      animateTo(0);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      if (progressAnimRef.current) clearInterval(progressAnimRef.current);
      setLoading(false);
      setStage("");
    }
  };

  const handleDownload = () => {
    if (!resultBase64) return;
    const a = document.createElement("a");
    a.href = `data:image/jpeg;base64,${resultBase64}`;
    a.download = `tryon-${Date.now()}.jpg`;
    a.click();
  };

  const stageLabel = STAGES.find((s) => s.key === stage)?.label ?? "";

  return (
    <div className="max-w-6xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold">图片试穿</h1>
        <p className="text-muted-foreground mt-2">
          上传你的全身照和心仪的服装，AI 为你生成试穿效果
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>人物照片</CardTitle>
            <CardDescription>上传一张清晰的全身照</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors min-h-[300px] flex items-center justify-center"
              onClick={() => !loading && personInputRef.current?.click()}
            >
              {personPreview ? (
                <Image src={personPreview} alt="人物照片" width={300} height={400}
                  className="max-h-[400px] w-auto object-contain rounded" />
              ) : (
                <div className="text-muted-foreground">
                  <p className="text-4xl mb-2">+</p>
                  <p>点击上传人物全身照</p>
                  <p className="text-xs mt-1">支持 JPG、PNG 格式</p>
                </div>
              )}
            </div>
            <Input ref={personInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0], setPersonImage, setPersonPreview)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>服装图片</CardTitle>
            <CardDescription>上传你想试穿的服装（建议竖向平铺图）</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors min-h-[300px] flex items-center justify-center"
              onClick={() => !loading && clothingInputRef.current?.click()}
            >
              {clothingPreview ? (
                <Image src={clothingPreview} alt="服装图片" width={300} height={400}
                  className="max-h-[400px] w-auto object-contain rounded" />
              ) : (
                <div className="text-muted-foreground">
                  <p className="text-4xl mb-2">+</p>
                  <p>点击上传服装图片</p>
                  <p className="text-xs mt-1">支持 JPG、PNG 格式</p>
                </div>
              )}
            </div>
            <Input ref={clothingInputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0], setClothingImage, setClothingPreview)} />
          </CardContent>
        </Card>
      </div>

      {/* 开始按钮 + 进度条 */}
      <div className="mb-8 space-y-4">
        <div className="flex justify-center">
          <Button size="lg" onClick={handleTryOn} disabled={loading || !personImage || !clothingImage}
            className="min-w-[160px]">
            {loading ? "AI 合成中..." : "开始试穿"}
          </Button>
        </div>

        {(loading || progress > 0) && (
          <div className="max-w-xl mx-auto space-y-2">
            {/* 进度条 */}
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 rounded-full transition-all duration-300"
                style={{
                  width: `${progress}%`,
                  background: progress === 100
                    ? "hsl(var(--primary))"
                    : "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary)/0.7) 100%)",
                }}
              />
            </div>

            {/* 阶段步骤 */}
            <div className="flex justify-between text-xs text-muted-foreground px-0.5">
              {STAGES.filter(s => s.key !== "done").map((s) => {
                const done = STAGES.findIndex(x => x.key === stage) > STAGES.findIndex(x => x.key === s.key);
                const active = stage === s.key;
                return (
                  <span key={s.key} className={active ? "text-primary font-medium" : done ? "text-green-600" : ""}>
                    {done ? "✓ " : active ? "⟳ " : ""}{s.label}
                  </span>
                );
              })}
            </div>

            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>{stageLabel}{loading && stage === "infer" ? "（IDM-VTON 首次约 1-2 分钟）" : ""}</span>
              <span>已等待 {elapsedSec}s</span>
            </div>
          </div>
        )}
      </div>

      {/* 结果 */}
      {resultUrl && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>试穿结果</CardTitle>
              {resultInfo && <CardDescription className="mt-1">{resultInfo}</CardDescription>}
            </div>
            <Button variant="outline" size="sm" onClick={handleDownload} className="shrink-0">
              下载图片
            </Button>
          </CardHeader>
          <CardContent className="flex justify-center">
            <img src={resultUrl} alt="试穿结果" className="max-h-[500px] w-auto object-contain rounded" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
