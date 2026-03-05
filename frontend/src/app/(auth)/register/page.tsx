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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const origin = window.location.origin;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username },
        // 邮箱验证或 magic link 统一走回调路由
        emailRedirectTo: `${origin}/auth/callback?next=/tryon`,
      },
    });

    if (error) {
      toast.error("注册失败", { description: error.message });
      setLoading(false);
      return;
    }

    // 检查是否需要邮箱验证
    if (data?.user && !data.user.confirmed_at) {
      toast.success("注册成功", {
        description: "请查看邮箱完成验证",
      });
      router.push("/login");
    } else if (data?.session) {
      // 如果不需要验证或已自动登录，直接跳转
      toast.success("注册成功", {
        description: "正在跳转...",
      });
      router.push("/tryon");
      router.refresh();
    } else {
      toast.success("注册成功", {
        description: "请登录",
      });
      router.push("/login");
    }
    
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">注册</CardTitle>
          <CardDescription>创建新账户，开启虚拟试穿之旅</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                placeholder="你的昵称"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 6 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "注册中..." : "注册"}
            </Button>
          </form>
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
