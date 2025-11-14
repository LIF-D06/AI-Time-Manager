# AI Time Manager - Azure 部署脚本 (PowerShell)
# 这个脚本帮助你快速部署到 Azure

param(
    [string]$ResourceGroup = "ai-time-manager-rg",
    [string]$Location = "East Asia",
    [string]$AppName = "ai-time-manager-$(Get-Date -Format 'yyyyMMddHHmmss')",
    [string]$AppServicePlan = "ai-time-manager-plan"
)

Write-Host "🚀 开始部署 AI Time Manager 到 Azure..." -ForegroundColor Green

# 检查 Azure CLI 是否安装
if (!(Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Azure CLI 未安装。请先安装 Azure CLI: https://aka.ms/install-azure-cli" -ForegroundColor Red
    exit 1
}

# 检查 Node.js 是否安装
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js 未安装。请先安装 Node.js 18+" -ForegroundColor Red
    exit 1
}

# 登录 Azure
Write-Host "🔑 登录 Azure..." -ForegroundColor Yellow
az login

# 创建资源组
Write-Host "📦 创建资源组..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location

# 创建应用服务计划
Write-Host "🏗️  创建应用服务计划..." -ForegroundColor Yellow
az appservice plan create `
  --name $AppServicePlan `
  --resource-group $ResourceGroup `
  --location $Location `
  --sku B1 `
  --is-linux

# 创建 Web 应用
Write-Host "🌐 创建 Web 应用..." -ForegroundColor Yellow
az webapp create `
  --resource-group $ResourceGroup `
  --plan $AppServicePlan `
  --name $AppName `
  --runtime "NODE|18-lts"

# 配置应用设置
Write-Host "⚙️  配置应用设置..." -ForegroundColor Yellow
az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $AppName `
  --settings `
    PORT=8080 `
    WEBSITE_NODE_DEFAULT_VERSION=18.17.0 `
    WEBSITE_RUN_FROM_PACKAGE=1

# 安装依赖和构建
Write-Host "📦 安装依赖和构建项目..." -ForegroundColor Yellow
npm install
npm run build
npm run build:server

# 创建部署包
Write-Host "📁 创建部署包..." -ForegroundColor Yellow
$deploymentZip = "deployment.zip"
if (Test-Path $deploymentZip) {
    Remove-Item $deploymentZip
}

# 压缩文件（排除不需要的文件和文件夹）
$excludePatterns = @("node_modules", ".git", "*.log", "dist", ".env", $deploymentZip)
Compress-Archive -Path * -DestinationPath $deploymentZip -Force

# 部署到 Azure
Write-Host "🚀 部署到 Azure..." -ForegroundColor Yellow
az webapp deployment source config-zip `
  --resource-group $ResourceGroup `
  --name $AppName `
  --src $deploymentZip

# 获取应用 URL
$AppUrl = "https://$AppName.azurewebsites.net"

Write-Host "✅ 部署完成！" -ForegroundColor Green
Write-Host "🌐 应用 URL: $AppUrl" -ForegroundColor Cyan
Write-Host "📖 下一步：" -ForegroundColor Yellow
Write-Host "   1. 配置环境变量（JWT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET 等）" -ForegroundColor White
Write-Host "   2. 更新 Microsoft 应用注册的重定向 URI 为: $AppUrl/redirect" -ForegroundColor White
Write-Host "   3. 访问应用并测试功能" -ForegroundColor White

# 清理
Write-Host "🧹 清理临时文件..." -ForegroundColor Yellow
if (Test-Path $deploymentZip) {
    Remove-Item $deploymentZip
}

Write-Host "🎉 部署脚本执行完成！" -ForegroundColor Green