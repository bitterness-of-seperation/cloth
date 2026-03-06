# API 代理配置说明

## 问题

当使用 HTTPS 内网穿透访问前端时，浏览器会阻止访问 HTTP 后端 API（混合内容错误）：
- 前端：`https://xxx.localtunnel.me`
- 后端：`http://8.138.196.217:8000`
- 浏览器：🚫 阻止 HTTPS 页面访问 HTTP 资源

## 解决方案

使用 Next.js API 路由作为代理，将请求转发到后端：

```
浏览器 (HTTPS) → Next.js API 路由 (HTTPS) → 后端服务器 (HTTP)
```

## 实现

### 1. API 路由代理
创建了 `frontend/src/app/api/tryon/generate/route.ts`，负责：
- 接收前端的 HTTPS 请求
- 转发到后端 HTTP API
- 返回结果给前端

### 2. 配置函数
修改了 `frontend/src/lib/config.ts`：
- 浏览器环境：使用相对路径 `/api/tryon/generate`（自动使用 HTTPS）
- 服务器环境：直接访问后端 `http://8.138.196.217:8000`

### 3. 环境变量
在 `.env.local` 中配置：
```env
BACKEND_URL=http://8.138.196.217:8000
```

## 请求流程

### 本地开发
```
浏览器 → http://localhost:3000/api/tryon/generate → http://8.138.196.217:8000/api/tryon/generate
```

### 内网穿透
```
浏览器 → https://xxx.localtunnel.me/api/tryon/generate → http://8.138.196.217:8000/api/tryon/generate
```

### 生产环境
```
浏览器 → https://yourdomain.com/api/tryon/generate → http://8.138.196.217:8000/api/tryon/generate
```

## 优势

1. ✅ 解决混合内容错误
2. ✅ 自动适配 HTTP/HTTPS
3. ✅ 无需修改后端
4. ✅ 统一的 API 调用方式
5. ✅ 支持本地开发和生产环境

## 部署

服务器上需要配置环境变量：

```bash
# 编辑服务器上的 .env.local
nano ~/app/frontend/.env.local

# 添加或修改
BACKEND_URL=http://localhost:8000  # 服务器上前后端在同一台机器，使用 localhost

# 重新构建
cd ~/app/frontend
npm run build
sudo systemctl restart tryon-frontend
```

## 注意事项

- 本地开发时，后端可以是远程服务器
- 生产环境建议前后端在同一台服务器，使用 localhost 提高性能
- API 路由会增加一次转发，但解决了 HTTPS/HTTP 混合内容问题
