import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    title: "图片试穿",
    description: "上传一张全身照，选择心仪的服装，AI 为你生成逼真的试穿效果",
    href: "/tryon",
    icon: "🖼️",
  },
  {
    title: "AR 实时试穿",
    description: "打开摄像头，实时查看服装穿在身上的效果，所见即所得",
    href: "/ar",
    icon: "📸",
  },
  {
    title: "社区分享",
    description: "分享你的穿搭效果，与其他用户交流讨论，发现更多搭配灵感",
    href: "/community",
    icon: "💬",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col items-center">
      <section className="py-20 text-center max-w-3xl">
        <h1 className="text-5xl font-bold tracking-tight mb-6">
          AI 虚拟试穿
        </h1>
        <p className="text-xl text-muted-foreground mb-8">
          利用 AI 技术，让你在线预览服装穿着效果。
          <br />
          上传照片或打开摄像头，即可体验智能穿搭。
        </p>
        <div className="flex gap-4 justify-center">
          <Button size="lg" asChild>
            <Link href="/tryon">开始试穿</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/register">免费注册</Link>
          </Button>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-6 w-full max-w-5xl pb-20">
        {features.map((feature) => (
          <Link key={feature.href} href={feature.href}>
            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="pt-6">
                <div className="text-4xl mb-4">{feature.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
