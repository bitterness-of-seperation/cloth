# 虚拟试穿应用 - PowerShell 开发环境启动脚本

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  虚拟试穿应用 - 开发环境" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否在项目根目录
if (-not (Test-Path "backend") -or -not (Test-Path "frontend")) {
    Write-Host "[错误] 请在项目根目录运行此脚本" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

# 检查 Python
Write-Host "[1/4] 检查 Python 环境..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "  ✓ $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ 未找到 Python，请先安装 Python 3.8+" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

# 检查 Node.js
Write-Host "[2/4] 检查 Node.js 环境..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ 未找到 Node.js，请先安装 Node.js" -ForegroundColor Red
    Read-Host "按回车键退出"
    exit 1
}

# 启动后端
Write-Host "[3/4] 启动后端服务 (端口 8000)..." -ForegroundColor Yellow
Set-Location backend

if (-not (Test-Path ".venv")) {
    Write-Host "  创建 Python 虚拟环境..." -ForegroundColor Gray
    python -m venv .venv
}

& .\.venv\Scripts\Activate.ps1
pip install -q -r requirements.txt

$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    & .\.venv\Scripts\Activate.ps1
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
}

Set-Location ..
Write-Host "  ✓ 后端服务已启动" -ForegroundColor Green

Start-Sleep -Seconds 2

# 启动前端
Write-Host "[4/4] 启动前端服务 (端口 3000)..." -ForegroundColor Yellow
Set-Location frontend
npm install --silent

$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    npm run dev
}

Set-Location ..
Write-Host "  ✓ 前端服务已启动" -ForegroundColor Green

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  服务启动成功！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  前端地址: " -NoNewline
Write-Host "http://localhost:3000" -ForegroundColor Cyan
Write-Host "  后端地址: " -NoNewline
Write-Host "http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API 文档: " -NoNewline
Write-Host "http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  按 Ctrl+C 停止所有服务" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 监控任务
try {
    while ($true) {
        Start-Sleep -Seconds 1
        
        # 检查任务状态
        if ($backendJob.State -ne "Running") {
            Write-Host "后端服务已停止" -ForegroundColor Red
            break
        }
        if ($frontendJob.State -ne "Running") {
            Write-Host "前端服务已停止" -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host "正在停止服务..." -ForegroundColor Yellow
    Stop-Job -Job $backendJob, $frontendJob
    Remove-Job -Job $backendJob, $frontendJob
    Write-Host "服务已停止" -ForegroundColor Green
}
