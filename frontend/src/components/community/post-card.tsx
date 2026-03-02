"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface PostCardProps {
  post: {
    id: string;
    content: string;
    image_urls: string[];
    created_at: string;
    user_id: string;
    profiles: { username: string; avatar_url: string };
    likes: { user_id: string }[];
    comments: {
      id: string;
      content: string;
      created_at: string;
      user_id: string;
      profiles: { username: string; avatar_url: string };
    }[];
  };
  currentUserId?: string;
  onUpdate: () => void;
}

export function PostCard({ post, currentUserId, onUpdate }: PostCardProps) {
  const supabase = createClient();
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [commenting, setCommenting] = useState(false);

  const isLiked = post.likes.some((l) => l.user_id === currentUserId);
  const likeCount = post.likes.length;
  const commentCount = post.comments.length;

  const handleLike = async () => {
    if (!currentUserId) {
      toast.error("请先登录");
      return;
    }

    if (isLiked) {
      await supabase
        .from("likes")
        .delete()
        .eq("post_id", post.id)
        .eq("user_id", currentUserId);
    } else {
      await supabase
        .from("likes")
        .insert({ post_id: post.id, user_id: currentUserId });
    }
    onUpdate();
  };

  const handleComment = async () => {
    if (!commentText.trim() || !currentUserId) return;
    setCommenting(true);

    const { error } = await supabase.from("comments").insert({
      post_id: post.id,
      user_id: currentUserId,
      content: commentText.trim(),
    });

    if (error) {
      toast.error("评论失败");
    } else {
      setCommentText("");
      onUpdate();
    }
    setCommenting(false);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return new Date(dateStr).toLocaleDateString("zh-CN");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={post.profiles.avatar_url} />
            <AvatarFallback>
              {post.profiles.username?.charAt(0)?.toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">
              {post.profiles.username || "用户"}
            </p>
            <p className="text-xs text-muted-foreground">
              {timeAgo(post.created_at)}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {post.content && <p className="text-sm">{post.content}</p>}

        {post.image_urls.length > 0 && (
          <div
            className={`grid gap-2 ${
              post.image_urls.length === 1
                ? "grid-cols-1"
                : post.image_urls.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-3"
            }`}
          >
            {post.image_urls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                className="w-full aspect-square object-cover rounded"
              />
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLike}
            className={isLiked ? "text-red-500" : ""}
          >
            {isLiked ? "♥" : "♡"} {likeCount > 0 && likeCount}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowComments(!showComments)}
          >
            评论 {commentCount > 0 && commentCount}
          </Button>
        </div>

        {showComments && (
          <>
            <Separator />
            <div className="space-y-3">
              {post.comments.map((comment) => (
                <div key={comment.id} className="flex gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={comment.profiles.avatar_url} />
                    <AvatarFallback className="text-xs">
                      {comment.profiles.username?.charAt(0)?.toUpperCase() ||
                        "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 bg-muted rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">
                        {comment.profiles.username || "用户"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm mt-0.5">{comment.content}</p>
                  </div>
                </div>
              ))}

              {currentUserId && (
                <div className="flex gap-2">
                  <Input
                    placeholder="写评论..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleComment()}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleComment}
                    disabled={commenting || !commentText.trim()}
                  >
                    发送
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
