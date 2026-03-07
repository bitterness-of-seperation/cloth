// 测试 Supabase 配置
const SUPABASE_URL = 'https://ftnwpvqmksaolgwuljbe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0bndwdnFta3Nhb2xnd3VsamJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODAzNzAsImV4cCI6MjA4Nzk1NjM3MH0.A8hJa6SvgbqlyjwJRyRTrpmFKwz_1t5YuTKT4hCbouM';

async function checkSupabaseConfig() {
  console.log('🔍 检查 Supabase 配置...\n');

  try {
    // 1. 检查认证设置
    console.log('1️⃣ 检查认证设置...');
    const settingsResponse = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
      }
    });

    if (!settingsResponse.ok) {
      console.log('❌ 无法获取认证设置');
      return;
    }

    const settings = await settingsResponse.json();
    console.log('✅ 认证设置获取成功\n');

    // 2. 检查匿名登录
    console.log('2️⃣ 检查匿名登录状态...');
    const anonymousEnabled = settings.external?.anonymous_users;
    
    if (anonymousEnabled) {
      console.log('✅ 匿名登录已启用');
    } else {
      console.log('❌ 匿名登录未启用');
      console.log('\n📝 启用步骤：');
      console.log('   1. 访问 https://supabase.com/dashboard');
      console.log('   2. 选择项目');
      console.log('   3. Authentication → Providers');
      console.log('   4. 启用 "Anonymous Sign-ins"');
    }

    // 3. 检查邮箱验证
    console.log('\n3️⃣ 检查邮箱验证设置...');
    const emailConfirm = settings.mailer_autoconfirm;
    
    if (emailConfirm) {
      console.log('✅ 邮箱自动确认已启用（无需验证）');
    } else {
      console.log('⚠️  需要邮箱验证');
    }

    // 4. 测试匿名登录
    if (anonymousEnabled) {
      console.log('\n4️⃣ 测试匿名登录...');
      const loginResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          data: { username: 'test-user' }
        })
      });

      if (loginResponse.ok) {
        console.log('✅ 匿名登录测试成功');
      } else {
        const error = await loginResponse.json();
        console.log('❌ 匿名登录测试失败');
        console.log('   错误:', error.msg || error.message);
      }
    }

    // 5. 显示完整配置
    console.log('\n📋 完整配置：');
    console.log(JSON.stringify(settings, null, 2));

  } catch (error) {
    console.error('❌ 检查失败:', error.message);
  }
}

checkSupabaseConfig();
