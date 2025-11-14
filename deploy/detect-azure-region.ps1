<#
.SYNOPSIS
    Azure 区域检测和自动选择脚本
.DESCRIPTION
    此脚本帮助选择最适合的 Azure 区域进行部署
.PARAMETER PreferredRegions
    逗号分隔的首选区域代码 (可选)
.EXAMPLE
    .\detect-azure-region.ps1
    .\detect-azure-region.ps1 -PreferredRegions "eastus"
    .\detect-azure-region.ps1 -PreferredRegions "eastus,westeurope,japaeast"
#>

param(
    [string]$PreferredRegions = ""
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

function Test-AzureCli {
    try {
        az --version | Out-Null
        return $true
    } catch {
        Write-ColorOutput "❌ Azure CLI 未安装或未登录" $Red
        Write-ColorOutput "请先安装 Azure CLI 并运行 'az login'" $Red
        exit 1
    }
}

function Get-SubscriptionInfo {
    Write-ColorOutput "📋 获取订阅信息..." $Blue
    
    try {
        $subscription = az account show | ConvertFrom-Json
        $subscriptionId = $subscription.id
        $subscriptionName = $subscription.name
        
        Write-ColorOutput "✅ 订阅ID: $subscriptionId" $Green
        Write-ColorOutput "✅ 订阅名称: $subscriptionName" $Green
        
        return $subscriptionId
    } catch {
        Write-ColorOutput "❌ 无法获取订阅信息" $Red
        exit 1
    }
}

function Get-AvailableRegions {
    Write-ColorOutput "🌍 检测可用区域..." $Blue
    
    try {
        # 获取推荐区域
        $recommendedRegions = az account list-locations `
            --query "[?metadata.regionCategory=='Recommended'].{Name:name, DisplayName:displayName, RegionCategory:metadata.regionCategory}" `
            -o json | ConvertFrom-Json
        
        # 获取所有可用区域
        $allRegions = az account list-locations `
            --query "[?metadata.regionType=='Physical' && state=='Enabled'].{Name:name, DisplayName:displayName}" `
            -o json | ConvertFrom-Json
        
        if ($null -eq $recommendedRegions -or $recommendedRegions.Count -eq 0) {
            # 使用默认区域列表
            $defaultRegions = @(
                @{ Name = "eastus"; DisplayName = "East US" },
                @{ Name = "westus2"; DisplayName = "West US 2" },
                @{ Name = "centralus"; DisplayName = "Central US" },
                @{ Name = "northeurope"; DisplayName = "North Europe" },
                @{ Name = "westeurope"; DisplayName = "West Europe" },
                @{ Name = "southeastasia"; DisplayName = "Southeast Asia" },
                @{ Name = "japaneast"; DisplayName = "Japan East" },
                @{ Name = "australiaeast"; DisplayName = "Australia East" },
                @{ Name = "uksouth"; DisplayName = "UK South" },
                @{ Name = "francecentral"; DisplayName = "France Central" }
            )
            $recommendedRegions = $defaultRegions
        }
        
        Write-ColorOutput "📊 发现 $($recommendedRegions.Count) 个推荐区域" $Green
        return $recommendedRegions
    } catch {
        Write-ColorOutput "❌ 无法获取区域信息" $Red
        exit 1
    }
}

function Test-RegionQuota {
    param([string]$Region, [string]$SubscriptionId)
    
    Write-ColorOutput "🔍 检查区域 $Region 的配额..." $Blue
    
    try {
        # 检查App Service配额 (简化检查)
        $webappSkus = az appservice list-locations --sku B1 --linux-workers-enabled --query "[?name=='$Region'].name" -o tsv 2>$null
        
        if ($webappSkus -contains $Region) {
            Write-ColorOutput "✅ 区域 $Region 支持 B1 级别的 Web 应用" $Green
            return $true
        } else {
            Write-ColorOutput "⚠️  区域 $Region 可能不支持 B1 级别的 Web 应用" $Yellow
            return $false
        }
    } catch {
        Write-ColorOutput "ℹ️  无法获取区域 $Region 的配额信息，假设可用" $Blue
        return $true
    }
}

function Test-RegionLatency {
    param([string]$Region, [string]$DisplayName)
    
    Write-ColorOutput "⏱️  测试到 $DisplayName ($Region) 的连接..." $Blue
    
    try {
        # 使用 Test-Connection (Windows) 或 ping (Linux/Mac)
        $testHost = "$Region.cloudapp.azure.com"
        
        if ($IsWindows -or $PSVersionTable.PSVersion.Major -lt 6) {
            # Windows PowerShell
            $pingResult = Test-Connection -ComputerName $testHost -Count 1 -ErrorAction SilentlyContinue
            if ($pingResult) {
                $latency = $pingResult.ResponseTime
                Write-ColorOutput "✅ 延迟: ${latency}ms" $Green
                return $latency
            }
        } else {
            # PowerShell Core (跨平台)
            $pingResult = ping -c 1 -W 2 $testHost 2>$null | Select-String "time=" | Select-Object -First 1
            if ($pingResult) {
                $latency = [regex]::Match($pingResult, "time=([0-9.]+)").Groups[1].Value
                if ($latency) {
                    Write-ColorOutput "✅ 延迟: ${latency}ms" $Green
                    return [int]$latency
                }
            }
        }
        
        Write-ColorOutput "ℹ️  无法测试延迟" $Blue
        return 999
    } catch {
        Write-ColorOutput "ℹ️  延迟测试失败" $Blue
        return 999
    }
}

function Select-BestRegion {
    param(
        [array]$AvailableRegions,
        [string]$PreferredRegions
    )
    
    Write-ColorOutput "🎯 选择最佳部署区域..." $Blue
    
    $subscriptionId = Get-SubscriptionInfo
    $bestRegion = $null
    $bestScore = 999999
    
    # 处理首选区域
    if (-not [string]::IsNullOrEmpty($PreferredRegions)) {
        $preferredList = $PreferredRegions -split ',' | ForEach-Object { $_.Trim() }
        
        foreach ($preferred in $preferredList) {
            $matchingRegion = $AvailableRegions | Where-Object { $_.Name -eq $preferred }
            
            if ($matchingRegion) {
                if (Test-RegionQuota -Region $preferred -SubscriptionId $subscriptionId) {
                    $latency = Test-RegionLatency -Region $preferred -DisplayName $matchingRegion.DisplayName
                    
                    Write-ColorOutput "⭐ 推荐首选区域: $($matchingRegion.DisplayName) ($preferred)" $Green
                    return $preferred
                }
            }
        }
    }
    
    # 如果没有首选区域或首选区域不可用，选择评分最高的区域
    Write-ColorOutput "🔍 评估所有可用区域..." $Blue
    
    foreach ($region in $AvailableRegions) {
        Write-ColorOutput "📍 评估区域: $($region.DisplayName) ($($region.Name))" $Blue
        
        if (Test-RegionQuota -Region $region.Name -SubscriptionId $subscriptionId) {
            $latency = Test-RegionLatency -Region $region.Name -DisplayName $region.DisplayName
            
            # 简单的评分系统（延迟越低越好）
            $score = $latency
            
            Write-ColorOutput "📊 区域评分 - $($region.DisplayName): $score" $Blue
            
            if ($score -lt $bestScore) {
                $bestScore = $score
                $bestRegion = $region
            }
        }
    }
    
    if ($bestRegion) {
        Write-ColorOutput "🏆 最佳区域: $($bestRegion.DisplayName) ($($bestRegion.Name))" $Green
        return $bestRegion.Name
    } else {
        Write-ColorOutput "❌ 没有找到合适的区域" $Red
        return "eastus"  # 默认区域
    }
}

function Show-RegionInfo {
    param([string]$Region)
    
    Write-ColorOutput "📍 区域详细信息:" $Blue
    
    try {
        $regionInfo = az account list-locations `
            --query "[?name=='$Region']" `
            -o json | ConvertFrom-Json
        
        if ($regionInfo) {
            Write-ColorOutput "名称: $($regionInfo.Name)" $Green
            Write-ColorOutput "显示名称: $($regionInfo.DisplayName)" $Green
            Write-ColorOutput "区域类别: $($regionInfo.metadata.regionCategory)" $Green
            Write-ColorOutput "地理组: $($regionInfo.metadata.geographyGroup)" $Green
        }
        
        # 检查Web应用可用性
        $webappSkus = az appservice list-locations --sku B1 --linux-workers-enabled --query "[?name=='$Region'].name" -o tsv 2>$null
        
        if ($webappSkus -contains $Region) {
            Write-ColorOutput "✅ 支持 B1 级别的 Web 应用" $Green
        } else {
            Write-ColorOutput "⚠️  可能不支持 B1 级别的 Web 应用" $Yellow
        }
    } catch {
        Write-ColorOutput "ℹ️  无法获取区域详细信息" $Blue
    }
}

function Save-Recommendation {
    param([string]$Region)
    
    $subscriptionId = Get-SubscriptionInfo
    $configFile = "azure-region-config.json"
    
    $config = @{
        recommendedRegion = $Region
        timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        subscriptionId = $subscriptionId
        deploymentConfig = @{
            resourceGroup = "ai-time-manager-rg"
            location = $Region
            appServicePlan = "ai-time-manager-plan"
            sku = "B1"
            runtime = "NODE:18-lts"
        }
    } | ConvertTo-Json -Depth 3
    
    $config | Out-File -FilePath $configFile -Encoding UTF8
    Write-ColorOutput "💾 推荐配置已保存到 $configFile" $Green
}

function Show-Help {
    @"
Azure 区域检测和选择工具

用法: .\detect-azure-region.ps1 [-PreferredRegions <字符串>]

参数:
  -PreferredRegions    逗号分隔的首选区域代码 (可选)
                       例如: "eastus"
                       例如: "eastus,westeurope,japaneast"

示例:
  .\detect-azure-region.ps1                    # 自动选择最佳区域
  .\detect-azure-region.ps1 -PreferredRegions "eastus"   # 首选美国东部
  .\detect-azure-region.ps1 -PreferredRegions "eastus,westeurope"  # 首选美国东部或西欧

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
  - francecentral (法国中部)

输出:
  返回推荐的最佳区域代码

"@
}

# 主函数
function Main {
    Write-ColorOutput "🌍 Azure 区域检测和选择工具" $Blue
    Write-ColorOutput "=================================" $Blue
    
    Test-AzureCli
    
    $availableRegions = Get-AvailableRegions
    $recommendedRegion = Select-BestRegion -AvailableRegions $availableRegions -PreferredRegions $PreferredRegions
    
    Show-RegionInfo -Region $recommendedRegion
    Save-Recommendation -Region $recommendedRegion
    
    Write-ColorOutput "`n🎯 推荐部署到: $recommendedRegion" $Green
    Write-ColorOutput "`n🚀 使用以下命令部署:" $Blue
    Write-ColorOutput "PowerShell: .\deploy-to-azure-fixed.ps1 -Location $recommendedRegion" $Yellow
    Write-ColorOutput "Bash: bash deploy-to-azure-fixed.sh LOCATION=$recommendedRegion" $Yellow
    
    return $recommendedRegion
}

# 处理命令行参数
if ($args -contains "-h" -or $args -contains "--help" -or $args -contains "help") {
    Show-Help
    exit 0
}

# 运行主函数
$recommendedRegion = Main
exit 0