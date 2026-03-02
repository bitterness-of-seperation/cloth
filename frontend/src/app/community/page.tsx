"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuthStore } from "@/stores/auth-store";
import { PostCard } from "@/components/community/post-card";
import { CreatePostDialog } from "@/components/community/create-post-dialog";
import { Button } from "@/components/ui/button";

interface Post {
  id: string;
  content: string;
  image_urls: string[];
  created_at: string;
  user_id: string;
  profiles: {
    username: string;
    avatar_url: string;
  };
  likes: { user_id: string }[];
  comments: {
    id: string;
    content: string;
    created_at: string;
    user_id: string;
    profiles: { username: string; avatar_url: string };
  }[];
}

export default function CommunityPage() {
  const { user } = useAuthStore();
  const supabase = createClient();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadPosts = useCallback(async () => {
    const { data } = await supabase
      .from("posts")
      .select(
        `
        id, content, image_urls, created_at, user_id,
        profiles (username, avatar_url),
        likes (user_id),
        comments (
          id, content, created_at, user_id,
          profiles (username, avatar_url)
        )
      `
      )
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      setPosts(data as unknown as Post[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">社区</h1>
          <p className="text-muted-foreground mt-1">
            分享你的穿搭，发现更多灵感
          </p>
        </div>
        {user && (
          <Button onClick={() => setDialogOpen(true)}>发布动态</Button>
        )}
      </div>

      <CreatePostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onPostCreated={loadPosts}
      />

      {loading ? (
        <div className="text-center py-20 text-muted-foreground">
          加载中...
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">还没有动态</p>
          <p className="text-sm mt-1">成为第一个分享穿搭的人吧</p>
        </div>
      ) : (
        <div className="space-y-6">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user?.id}
              onUpdate={loadPosts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
