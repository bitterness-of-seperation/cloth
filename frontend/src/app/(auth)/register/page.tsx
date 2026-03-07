"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!username.trim()) {
      toast.error("请输入用户名");
      return;
    }

    setLoading(true);

    try {
      // 使用匿名登录
      const { data, error } = await supabase.auth.signInAnonymously({
        options: {
          data: { username: username.trim() }
        }
      });

      if (error) {
        toast.error("注册失败", { description: error.message });
        setLoading(false);
        return;
      }

      if (data?.session) {
        toast.success("注册成功", {
          description: `欢迎，${username}！`,
        });
        router.push("/tryon");
        router.refresh();
      } else {
        toast.error("注册失败", { description: "未能创建会话" });
      }
    } catch (error) {
      toast.error("注册失败", { 
        description: error instanceof Error ? error.message : "未知错误" 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">快速开始</CardTitle>
          <CardDescription>输入昵称即可开始使用，无需邮箱验证</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                placeholder="输入你的昵称"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={2}
                maxLength={20}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                2-20 个字符，支持中文、英文、数字
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "创建中..." : "立即开始"}
            </Button>
          </form>
          
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground">
              💡 提示：使用匿名账号，数据保存在本地浏览器中。
              清除浏览器数据会丢失账号信息。
            </p>
          </div>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            已有账号？{" "}
            <Link href="/login" className="text-primary hover:underline">
              立即登录
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
