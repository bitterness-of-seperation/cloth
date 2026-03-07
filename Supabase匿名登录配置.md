# Supabase 匿名登录配置指南

## 错误信息
```
Database error creating anonymous user
```

## 原因
Supabase 项目默认没有启用匿名登录功能。

## 解决方案

### 方法 1：启用 Supabase 匿名登录（推荐）

1. **登录 Supabase Dashboard**
   - 访问：https://supabase.com/dashboard
   - 选择项目：`ftnwpvqmksaolgwuljbe`

2. **启用匿名登录**
   - 左侧菜单点击 `Authentication`
   - 点击 `Providers`
   - 找到 `Anonymous Sign-ins`
   - 点击右侧的开关，启用该功能
   - 点击 `Save` 保存

3. **测试**
   - 刷新前端页面
   - 尝试注册/登录
   - 应该可以正常使用

---

### 方法 2：使用简化的邮箱注册（临时方案）

如果不想启用匿名登录，可以使用简化的邮箱注册，不需要验证：

#### 步骤 1：在 Supabase 中关闭邮箱验证

1. 进入 `Authentication` → `Providers`
2. 点击 `Email` 提供商
3. 找到 `Confirm email` 选项
4. **取消勾选** `Enable email confirmations`
5. 点击 `Save`

#### 步骤 2：修改前端代码

使用简化的邮箱注册（已在代码中实现，只需切换）

---

### 方法 3：使用测试邮箱（开发环境）

Supabase 支持测试邮箱，不会真正发送邮件：

1. 在 Supabase Dashboard 中
2. 进入 `Authentication` → `Settings`
3. 找到 `SMTP Settings`
4. 启用 `Enable Custom SMTP`
5. 使用 Mailtrap 或类似的测试邮箱服务

---

## 推荐配置

### 开发环境
- 启用匿名登录
- 或关闭邮箱验证

### 生产环境
- 启用邮箱验证
- 配置自定义 SMTP
- 或使用 OAuth（Google、GitHub）

---

## 当前状态检查

访问以下 URL 检查配置：
```
https://ftnwpvqmksaolgwuljbe.supabase.co/auth/v1/settings
```

查看返回的 JSON 中：
- `"anonymous_users": true` - 匿名登录已启用
- `"anonymous_users": false` - 匿名登录未启用

---

## 快速启用脚本

如果有 Supabase CLI，可以使用命令行启用：

```bash
# 安装 Supabase CLI
npm install -g supabase

# 登录
supabase login

# 启用匿名登录
supabase projects api-keys --project-ref ftnwpvqmksaolgwuljbe
```

---

## 故障排查

### 问题：启用后仍然报错
**解决**：
1. 清除浏览器缓存
2. 等待 1-2 分钟（配置生效需要时间）
3. 检查 Supabase 项目状态

### 问题：找不到匿名登录选项
**解决**：
- 确保使用的是最新版 Supabase Dashboard
- 某些旧项目可能不支持，需要升级

### 问题：匿名用户无法访问数据
**解决**：
需要配置 Row Level Security (RLS) 策略：

```sql
-- 允许匿名用户读取自己的数据
CREATE POLICY "Users can view own data"
ON tryon_results
FOR SELECT
USING (auth.uid() = user_id);

-- 允许匿名用户插入数据
CREATE POLICY "Users can insert own data"
ON tryon_results
FOR INSERT
WITH CHECK (auth.uid() = user_id);
```

---

## 联系支持

如果以上方法都无法解决，请：
1. 检查 Supabase 项目是否正常运行
2. 查看 Supabase 控制台的日志
3. 联系 Supabase 支持团队
