/**
 * 获取 API 基础 URL
 * 支持多种部署场景：本地开发、内网穿透、生产环境
 */
export function getApiUrl(): string {
  // 在浏览器环境中，使用相对路径（通过 Next.js API 路由代理）
  if (typeof window !== 'undefined') {
    // 使用当前域名的 API 路由，自动匹配协议（http/https）
    return '';  // 空字符串表示使用相对路径 /api/tryon/generate
  }

  // SSR 环境：直接访问后端
  return process.env.BACKEND_URL || 'http://8.138.196.217:8000';
}
