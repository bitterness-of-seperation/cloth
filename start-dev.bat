@echo off
REM 虚拟试穿应用 - Windows 开发环境启动脚本

echo.
echo ========================================
echo   虚拟试穿应用 - 开发环境
echo ========================================
echo.

REM 检查是否在项目根目录
if not exist "backend" (
    echo [错误] 请在项目根目录运行此脚本
    pause
    exit /b 1
)

if not exist "frontend" (
    echo [错误] 请在项目根目录运行此脚本
    pause
    exit /b 1
)

echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)

echo [2/4] 检查 Node.js 环境...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo [3/4] 启动后端服务 (端口 8000)...
cd backend
if not exist ".venv" (
    echo 创建 Python 虚拟环境...
    python -m venv .venv
)
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
start "后端服务" cmd /k "uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
cd ..

echo 等待后端启动...
timeout /t 3 /nobreak >nul

echo [4/4] 启动前端服务 (端口 3000)...
cd frontend
call npm install --silent
start "前端服务" cmd /k "npm run dev"
cd ..

echo.
echo ========================================
echo   服务启动成功！
echo ========================================
echo.
echo   前端地址: http://localhost:3000
echo   后端地址: http://localhost:8000
echo   API 文档: http://localhost:8000/docs
echo.
echo   关闭窗口即可停止服务
echo ========================================
echo.

pause
