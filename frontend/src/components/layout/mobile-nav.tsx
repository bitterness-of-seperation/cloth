"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

const navItems = [
  { href: "/tryon", label: "试穿", icon: "🖼️" },
  { href: "/ar", label: "AR", icon: "📸" },
  { href: "/community", label: "社区", icon: "💬" },
  { href: "/profile", label: "我的", icon: "👤" },
];

export function MobileNav() {
  const pathname = usePathname();
  const { user, loading } = useAuthStore();

  if (!user && !loading) return null;
  if (loading) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
      <div className="grid grid-cols-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center py-2 text-xs transition-colors ${
              pathname === item.href
                ? "text-primary"
                : "text-muted-foreground"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
