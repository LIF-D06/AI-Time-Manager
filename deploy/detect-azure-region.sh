#!/bin/bash

# Azure 区域检测和自动选择脚本
# 此脚本帮助选择最适合的 Azure 区域进行部署

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RESET='\033[0m'

write_color() {
    local message="$1"
    local color="${2:-$GREEN}"
    echo -e "${color}${message}${RESET}"
}

# 检查Azure CLI
check_azure_cli() {
    if ! command -v az &> /dev/null; then
        write_color "❌ Azure CLI 未安装" "$RED"
        exit 1
    fi
    
    if ! az account show &> /dev/null; then
        write_color "❌ Azure CLI 未登录" "$RED"
        write_color "请先运行 'az login'" "$RED"
        exit 1
    fi
}

# 获取订阅信息
get_subscription_info() {
    write_color "📋 获取订阅信息..." "$BLUE"
    
    local subscription_id=$(az account show --query id -o tsv)
    local subscription_name=$(az account show --query name -o tsv)
    
    write_color "✅ 订阅ID: $subscription_id" "$GREEN"
    write_color "✅ 订阅名称: $subscription_name" "$GREEN"
    
    echo "$subscription_id"
}

# 获取可用区域
get_available_regions() {
    write_color "🌍 检测可用区域..." "$BLUE"
    
    # 获取推荐区域
    local recommended_regions=$(az account list-locations \
        --query "[?metadata.regionCategory=='Recommended'].{Name:name, DisplayName:displayName, RegionCategory:metadata.regionCategory}" \
        -o tsv 2>/dev/null | head -20)
    
    # 获取所有可用区域
    local all_regions=$(az account list-locations \
        --query "[?metadata.regionType=='Physical' && state=='Enabled'].{Name:name, DisplayName:displayName}" \
        -o tsv 2>/dev/null | head -30)
    
    if [ -z "$recommended_regions" ]; then
        # 使用默认区域列表
        recommended_regions=$(cat <<EOF
eastus	East US
westus2	West US 2
centralus	Central US
northeurope	North Europe
westeurope	West Europe
southeastasia	Southeast Asia
japaneast	Japan East
australiaeast	Australia East
uksouth	UK South
francecentral	France Central
EOF
)
    fi
    
    echo "$recommended_regions"
}

# 检查区域配额
check_region_quota() {
    local region="$1"
    local resource_type="Microsoft.Web/serverFarms"
    
    write_color "🔍 检查区域 $region 的配额..." "$BLUE"
    
    # 检查App Service配额
    local quota_info=$(az quota show \
        --resource-name "$resource_type" \
        --scope "/subscriptions/$(get_subscription_info)/providers/Microsoft.Compute/locations/$region" \
        2>/dev/null || echo "")
    
    if [ -n "$quota_info" ]; then
        local current_usage=$(echo "$quota_info" | grep -o '"currentValue":[0-9]*' | cut -d':' -f2 || echo "0")
        local limit=$(echo "$quota_info" | grep -o '"limit":[0-9]*' | cut -d':' -f2 || echo "0")
        
        if [ "$current_usage" -lt "$limit" ]; then
            write_color "✅ 区域 $region 配额充足" "$GREEN"
            return 0
        else
            write_color "⚠️  区域 $region 配额不足" "$YELLOW"
            return 1
        fi
    else
        write_color "ℹ️  无法获取区域 $region 的配额信息，假设可用" "$BLUE"
        return 0
    fi
}

# 测试区域延迟（简单测试）
test_region_latency() {
    local region="$1"
    local display_name="$2"
    
    write_color "⏱️  测试到 $display_name ($region) 的连接..." "$BLUE"
    
    # 使用Azure的门户域名测试延迟
    local test_host="https://$region.management.azure.com"
    
    # 简单的ping测试（如果可用）
    if command -v ping &> /dev/null; then
        local ping_result=$(ping -c 1 -W 2 "$(echo $region | sed 's/[0-9]*//g').cloudapp.azure.com" 2>/dev/null | grep "time=" | tail -1 | grep -o "time=[0-9.]*" | cut -d'=' -f2 || echo "N/A")
        
        if [ "$ping_result" != "N/A" ]; then
            write_color "✅ 延迟: ${ping_result}ms" "$GREEN"
            echo "$ping_result"
        else
            write_color "ℹ️  无法测试延迟" "$BLUE"
            echo "999"
        fi
    else
        write_color "ℹ️  ping命令不可用，跳过延迟测试" "$BLUE"
        echo "999"
    fi
}

# 选择最佳区域
select_best_region() {
    local available_regions="$1"
    local preferred_regions="${2:-}"
    
    write_color "🎯 选择最佳部署区域..." "$BLUE"
    
    local best_region=""
    local best_score=999999
    local best_display_name=""
    
    # 处理首选区域
    if [ -n "$preferred_regions" ]; then
        IFS=',' read -ra PREFERRED <<< "$preferred_regions"
        for preferred in "${PREFERRED[@]}"; do
            preferred=$(echo "$preferred" | xargs)  # 去除空格
            
            while IFS=$'\t' read -r name display_name; do
                if [ "$name" = "$preferred" ]; then
                    if check_region_quota "$name"; then
                        local latency=$(test_region_latency "$name" "$display_name")
                        
                        write_color "⭐ 推荐首选区域: $display_name ($name)" "$GREEN"
                        echo "$name"
                        return 0
                    fi
                fi
            done <<< "$available_regions"
        done
    fi
    
    # 如果没有首选区域或首选区域不可用，选择评分最高的区域
    write_color "🔍 评估所有可用区域..." "$BLUE"
    
    while IFS=$'\t' read -r name display_name; do
        if [ -n "$name" ] && [ -n "$display_name" ]; then
            write_color "📍 评估区域: $display_name ($name)" "$BLUE"
            
            if check_region_quota "$name"; then
                local latency=$(test_region_latency "$name" "$display_name")
                
                # 简单的评分系统（延迟越低越好）
                local score=$latency
                
                write_color "📊 区域评分 - $display_name: $score" "$BLUE"
                
                if [ "$score" -lt "$best_score" ]; then
                    best_score=$score
                    best_region=$name
                    best_display_name=$display_name
                fi
            fi
        fi
    done <<< "$available_regions"
    
    if [ -n "$best_region" ]; then
        write_color "🏆 最佳区域: $best_display_name ($best_region)" "$GREEN"
        echo "$best_region"
    else
        write_color "❌ 没有找到合适的区域" "$RED"
        echo "eastus"  # 默认区域
    fi
}

# 显示区域信息
show_region_info() {
    local region="$1"
    
    write_color "📍 区域详细信息:" "$BLUE"
    
    # 获取区域详细信息
    local region_info=$(az account list-locations \
        --query "[?name=='$region'].{Name:name, DisplayName:displayName, RegionCategory:metadata.regionCategory, GeographyGroup:metadata.geographyGroup}" \
        -o json 2>/dev/null || echo "")
    
    if [ -n "$region_info" ]; then
        echo "$region_info" | jq -r '.[] | "名称: \(.Name)\n显示名称: \(.DisplayName)\n区域类别: \(.RegionCategory)\n地理组: \(.GeographyGroup)"' 2>/dev/null || echo "$region_info"
    fi
    
    # 检查Web应用可用性
    local webapp_skus=$(az appservice list-locations --sku B1 --linux-workers-enabled --query "[?name=='$region'].name" -o tsv 2>/dev/null || echo "")
    
    if [ -n "$webapp_skus" ]; then
        write_color "✅ 支持 B1 级别的 Web 应用" "$GREEN"
    else
        write_color "⚠️  可能不支持 B1 级别的 Web 应用" "$YELLOW"
    fi
}

# 保存推荐配置
save_recommendation() {
    local region="$1"
    local config_file="azure-region-config.json"
    
    local config=$(cat <<EOF
{
    "recommendedRegion": "$region",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "subscriptionId": "$(get_subscription_info)",
    "deploymentConfig": {
        "resourceGroup": "ai-time-manager-rg",
        "location": "$region",
        "appServicePlan": "ai-time-manager-plan",
        "sku": "B1",
        "runtime": "NODE:18-lts"
    }
}
EOF
)
    
    echo "$config" > "$config_file"
    write_color "💾 推荐配置已保存到 $config_file" "$GREEN"
}

# 主函数
main() {
    local preferred_regions="$1"
    
    write_color "🌍 Azure 区域检测和选择工具" "$BLUE"
    write_color "=================================" "$BLUE"
    
    check_azure_cli
    get_subscription_info
    
    local available_regions=$(get_available_regions)
    
    if [ -z "$available_regions" ]; then
        write_color "❌ 无法获取可用区域信息" "$RED"
        exit 1
    fi
    
    write_color "📊 发现 $(echo "$available_regions" | wc -l) 个可用区域" "$GREEN"
    
    local recommended_region=$(select_best_region "$available_regions" "$preferred_regions")
    
    show_region_info "$recommended_region"
    
    save_recommendation "$recommended_region"
    
    write_color "\n🎯 推荐部署到: $recommended_region" "$GREEN"
    write_color "\n🚀 使用以下命令部署:" "$BLUE"
    write_color "PowerShell: .\\deploy-to-azure-fixed.ps1 -Location $recommended_region" "$YELLOW"
    write_color "Bash: bash deploy-to-azure-fixed.sh LOCATION=$recommended_region" "$YELLOW"
    
    echo "$recommended_region"
}

# 显示帮助
show_help() {
    cat <<EOF
Azure 区域检测和选择工具

用法: $0 [首选区域列表]

参数:
  首选区域列表    逗号分隔的首选区域代码 (可选)
                  例如: eastus,westeurope,japaneast

示例:
  $0                    # 自动选择最佳区域
  $0 eastus             # 首选美国东部
  $0 eastus,westeurope   # 首选美国东部或西欧

支持的常用区域:
  - eastus (美国东部)
  - westus2 (美国西部 2)
  - centralus (美国中部)
  - northeurope (北欧)
  - westeurope (西欧)
  - southeastasia (东南亚)
  - japaneast (日本东部)
  - australiaeast (澳大利亚东部)
  - uksouth (英国南部)
  - francesouth (法国南部)

输出:
  返回推荐的最佳区域代码

EOF
}

# 处理命令行参数
case "${1:-}" in
    -h|--help|help)
        show_help
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac