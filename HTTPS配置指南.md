# HTTPS 配置指南 - 解决摄像头访问问题

## 问题说明

现代浏览器出于安全考虑，只允许在以下情况访问摄像头：
- ✅ HTTPS 网站
- ✅ localhost / 127.0.0.1
- ❌ HTTP 网站（非 localhost）

当前服务器使用 HTTP，所以无法访问摄像头。

## 解决方案

### 方案 1：使用免费 SSL 证书（推荐）

使用 Let's Encrypt 提供的免费 SSL 证书，配合 Nginx 反向代理。

#### 步骤 1：安装 Certbot

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install certbot python3-certbot-nginx -y
```

#### 步骤 2：安装 Nginx

```bash
sudo apt install nginx -y
```

#### 步骤 3：配置 Nginx

创建配置文件：
```bash
sudo nano /etc/nginx/sites-available/tryon
```

写入以下内容（替换 `your-domain.com` 为你的域名）：
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 后端 API
    location /api/ {
        proxy_pass http://localhost:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：
```bash
sudo ln -s /etc/nginx/sites-available/tryon /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 步骤 4：申请 SSL 证书

```bash
sudo certbot --nginx -d your-domain.com
```

按提示操作：
1. 输入邮箱
2. 同意服务条款
3. 选择是否重定向 HTTP 到 HTTPS（建议选择 2）

Certbot 会自动修改 Nginx 配置，添加 SSL 证书。

#### 步骤 5：自动续期

Let's Encrypt 证书有效期 90 天，设置自动续期：
```bash
sudo certbot renew --dry-run
```

如果测试成功，证书会自动续期。

---

### 方案 2：使用 Cloudflare（最简单）

如果你有域名，可以使用 Cloudflare 的免费 SSL。

#### 步骤：

1. 注册 Cloudflare 账号：https://cloudflare.com
2. 添加你的域名
3. 修改域名的 DNS 服务器为 Cloudflare 提供的服务器
4. 在 Cloudflare 控制台开启 SSL（Flexible 模式）
5. 添加 DNS 记录指向你的服务器 IP

优点：
- 完全免费
- 自动 HTTPS
- 自带 CDN 加速
- 自动续期

---

### 方案 3：临时测试方案（仅用于开发）

#### Chrome 浏览器设置

1. 访问：`chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. 启用该选项
3. 在输入框中添加你的服务器地址：`http://8.138.196.217:3000`
4. 重启浏览器

⚠️ 注意：这只是临时方案，不适合生产环境。

#### Firefox 浏览器设置

1. 访问：`about:config`
2. 搜索：`media.devices.insecure.enabled`
3. 设置为 `true`

---

### 方案 4：使用自签名证书（开发环境）

生成自签名证书：

```bash
# 生成证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 配置 Nginx 使用证书
sudo nano /etc/nginx/sites-available/tryon
```

添加 SSL 配置：
```nginx
server {
    listen 443 ssl;
    server_name 8.138.196.217;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        # ... 其他配置
    }
}
```

⚠️ 注意：浏览器会显示"不安全"警告，需要手动信任证书。

---

## 推荐方案对比

| 方案 | 难度 | 成本 | 适用场景 |
|------|------|------|----------|
| Let's Encrypt | ⭐⭐ | 免费 | 生产环境（推荐） |
| Cloudflare | ⭐ | 免费 | 有域名的生产环境 |
| Chrome Flags | ⭐ | 免费 | 临时测试 |
| 自签名证书 | ⭐⭐⭐ | 免费 | 开发环境 |

---

## 快速开始（推荐：Cloudflare）

如果你有域名，最简单的方式是：

1. 注册 Cloudflare
2. 添加域名
3. 修改 DNS 服务器
4. 开启 SSL
5. 完成！

整个过程不到 10 分钟，完全免费，还有 CDN 加速。

---

## 没有域名怎么办？

### 选项 1：购买域名
- 阿里云：约 ¥10/年（.top 域名）
- 腾讯云：约 ¥10/年
- Namecheap：约 $1/年

### 选项 2：使用免费域名
- Freenom：提供免费 .tk/.ml/.ga 域名
- 注意：免费域名可能不稳定

### 选项 3：使用 IP + Let's Encrypt
Let's Encrypt 也支持 IP 地址，但需要验证：
```bash
sudo certbot certonly --standalone -d 8.138.196.217
```

---

## 配置后的访问方式

配置 HTTPS 后：
- 前端：`https://your-domain.com`
- 后端 API：`https://your-domain.com/api/`
- AR 功能：✅ 可以访问摄像头

---

## 故障排查

### 证书申请失败
- 检查域名是否正确解析到服务器 IP
- 检查防火墙是否开放 80 和 443 端口
- 检查 Nginx 是否正在运行

### 摄像头仍然无法访问
- 检查浏览器地址栏是否显示 🔒（安全）
- 检查浏览器是否允许摄像头权限
- 清除浏览器缓存重试

### Nginx 配置错误
```bash
# 测试配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log
```
