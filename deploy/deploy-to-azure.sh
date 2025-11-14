#!/bin/bash

# AI Time Manager - Azure 部署脚本
# 这个脚本帮助你快速部署到 Azure

set -e

echo "🚀 开始部署 AI Time Manager 到 Azure..."

# 检查 Azure CLI 是否安装
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI 未安装。请先安装 Azure CLI: https://aka.ms/install-azure-cli"
    exit 1
fi

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装。请先安装 Node.js 18+"
    exit 1
fi

# 配置变量
RESOURCE_GROUP="ai-time-manager-rg"
LOCATION="East Asia"
APP_NAME="ai-time-manager-$(date +%s)"  # 使用时间戳确保唯一性
APP_SERVICE_PLAN="ai-time-manager-plan"

# 登录 Azure
echo "🔑 登录 Azure..."
az login

# 创建资源组
echo "📦 创建资源组..."
az group create --name $RESOURCE_GROUP --location "$LOCATION"

# 创建应用服务计划
echo "🏗️  创建应用服务计划..."
az appservice plan create \
  --name $APP_SERVICE_PLAN \
  --resource-group $RESOURCE_GROUP \
  --location "$LOCATION" \
  --sku B1 \
  --is-linux

# 创建 Web 应用
echo "🌐 创建 Web 应用..."
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan $APP_SERVICE_PLAN \
  --name $APP_NAME \
  --runtime "NODE|18-lts"

# 配置应用设置
echo "⚙️  配置应用设置..."
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    PORT=8080 \
    WEBSITE_NODE_DEFAULT_VERSION=18.17.0 \
    WEBSITE_RUN_FROM_PACKAGE=1

# 安装依赖和构建
echo "📦 安装依赖和构建项目..."
npm install
npm run build
npm run build:server

# 创建部署包
echo "📁 创建部署包..."
zip -r deployment.zip . -x "node_modules/*" ".git/*" "*.log" "dist" ".env" 

# 部署到 Azure
echo "🚀 部署到 Azure..."
az webapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --src deployment.zip

# 获取应用 URL
APP_URL="https://$APP_NAME.azurewebsites.net"

echo "✅ 部署完成！"
echo "🌐 应用 URL: $APP_URL"
echo "📖 下一步："
echo "   1. 配置环境变量（JWT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET 等）"
echo "   2. 更新 Microsoft 应用注册的重定向 URI 为: $APP_URL/redirect"
echo "   3. 访问应用并测试功能"

# 清理
echo "🧹 清理临时文件..."
rm -f deployment.zip

echo "🎉 部署脚本执行完成！"