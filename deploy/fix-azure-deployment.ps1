<#
.SYNOPSIS
    修复 Azure 部署问题 - 配置启动命令和环境变量
.DESCRIPTION
    此脚本修复 Azure Web 应用的启动配置问题
#>

param(
    [string]$ResourceGroup = "ai-time-manager-rg",
    [string]$WebAppName = "ai-time-manager-20251114143550"
)

# 颜色输出
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

function Write-ColorOutput {
    param([string]$Message, [string]$Color = $Green)
    Write-Host "$Color$Message$Reset"
}

Write-ColorOutput "🔧 修复 Azure 部署配置" $Blue
Write-ColorOutput "========================" $Blue

# 1. 配置启动命令
Write-ColorOutput "1️⃣ 配置启动命令..." $Blue
az webapp config set --name $WebAppName --resource-group $ResourceGroup --startup-file "node server/dist/index.js"

if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput "✅ 启动命令配置成功" $Green
} else {
    Write-ColorOutput "❌ 启动命令配置失败" $Red
    exit 1
}


# 3. 更新应用设置
Write-ColorOutput "3️⃣ 更新应用设置..." $Blue

# 设置必要的应用设置
az webapp config appsettings set --name $WebAppName --resource-group $ResourceGroup --settings `
    "PORT=8080" `
    "NODE_ENV=production" `
    "WEBSITE_RUN_FROM_PACKAGE=0" `
    "SCM_DO_BUILD_DURING_DEPLOYMENT=false"

if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput "✅ 应用设置更新成功" $Green
} else {
    Write-ColorOutput "❌ 应用设置更新失败" $Red
    exit 1
}

# 4. 重启应用
Write-ColorOutput "4️⃣ 重启应用..." $Blue
az webapp restart --name $WebAppName --resource-group $ResourceGroup

if ($LASTEXITCODE -eq 0) {
    Write-ColorOutput "✅ 应用重启成功" $Green
} else {
    Write-ColorOutput "❌ 应用重启失败" $Red
    exit 1
}

Write-ColorOutput "`n✅ 修复完成！" $Green
Write-ColorOutput "🌐 应用URL: https://$WebAppName.azurewebsites.net" $Green
Write-ColorOutput "`n⏳ 请等待 2-3 分钟让应用完全启动..." $Yellow

Write-ColorOutput "`n🔍 检查应用状态:" $Blue
Write-ColorOutput "查看日志: az webapp log tail --name $WebAppName --resource-group $ResourceGroup" $Blue