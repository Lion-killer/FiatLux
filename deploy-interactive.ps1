# FiatLux Docker Deployment Tool for Windows
# Interactive deployment

$ErrorActionPreference = "Continue"

# Colors
$colors = @{
    Success = "Green"
    Error = "Red"
    Warning = "Yellow"
    Info = "Cyan"
    Menu = "Magenta"
}

# Global Config
$global:Config = @{
    Server = ""
    Port = 3000
    User = "ubuntu"
    Password = ""
    RepoUrl = ""
    ApiId = ""
    ApiHash = ""
    Channel = "pat_cherkasyoblenergo"
}

$global:ConfigFile = ".\.deploy-config.env"

function Write-HD {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 50) -ForegroundColor $colors.Menu
    Write-Host "  $Text" -ForegroundColor $colors.Menu
    Write-Host ("=" * 50) -ForegroundColor $colors.Menu
}

function Write-OK {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor $colors.Success
}

function Write-ERR {
    param([string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor $colors.Error
}

function Write-WRN {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor $colors.Warning
}

function Write-INF {
    param([string]$Text)
    Write-Host "[INFO] $Text" -ForegroundColor $colors.Info
}

function SSH-Run {
    param([string]$Cmd)
    
    $sshTarget = "$($global:Config.User)@$($global:Config.Server)"
    
    # Check if plink is available (PuTTY)
    $plinkPath = Get-Command plink -ErrorAction SilentlyContinue
    
    try {
        if ($plinkPath -and $global:Config.Password) {
            # Use plink with password
            $result = & plink -batch -pw $global:Config.Password $sshTarget $Cmd 2>&1
        } else {
            # Use standard ssh (will prompt for password if needed)
            $result = & ssh $sshTarget $Cmd 2>&1
        }
        return $result
    }
    catch {
        Write-ERR "SSH Error: $_"
        return $null
    }
}

function Load-Config {
    if (Test-Path $global:ConfigFile) {
        Write-INF "Loading configuration from $global:ConfigFile"
        
        Get-Content $global:ConfigFile | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#")) {
                $parts = $line -split "=", 2
                if ($parts.Count -eq 2) {
                    $key = $parts[0].Trim()
                    $value = $parts[1].Trim()
                    
                    switch ($key) {
                        "DEPLOY_SERVER" { $global:Config.Server = $value }
                        "DEPLOY_USER" { $global:Config.User = $value }
                        "DEPLOY_PASSWORD" { $global:Config.Password = $value }
                        "DEPLOY_REPO_URL" { $global:Config.RepoUrl = $value }
                        "DEPLOY_PORT" { $global:Config.Port = [int]$value }
                        "API_ID" { $global:Config.ApiId = $value }
                        "API_HASH" { $global:Config.ApiHash = $value }
                        "CHANNEL_USERNAME" { $global:Config.Channel = $value }
                    }
                }
            }
        }
        
        Write-OK "Configuration loaded"
    } else {
        Write-WRN "No configuration file found. Using defaults."
    }
}

function Save-Config {
    $content = @"
# FiatLux Deployment Configuration
# Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# Server Settings
DEPLOY_SERVER=$($global:Config.Server)
DEPLOY_USER=$($global:Config.User)
DEPLOY_PASSWORD=$($global:Config.Password)
DEPLOY_PORT=$($global:Config.Port)

# Repository
DEPLOY_REPO_URL=$($global:Config.RepoUrl)

# Telegram API
API_ID=$($global:Config.ApiId)
API_HASH=$($global:Config.ApiHash)
CHANNEL_USERNAME=$($global:Config.Channel)
"@
    
    $content | Set-Content $global:ConfigFile -Encoding UTF8
    Write-OK "Configuration saved to $global:ConfigFile"
}

function Show-Config {
    Write-HD "Current Configuration"
    Write-Host ""
    
    Write-Host "Server Settings:" -ForegroundColor $colors.Info
    Write-Host "  Server:       $($global:Config.Server)" -ForegroundColor White
    Write-Host "  User:         $($global:Config.User)" -ForegroundColor White
    
    # Mask password
    if ($global:Config.Password -and $global:Config.Password.Length -gt 0) {
        $passwordDisplay = "***" + "*" * [Math]::Min($global:Config.Password.Length - 1, 8)
    } else {
        $passwordDisplay = "[NOT SET]"
    }
    Write-Host "  Password:     $passwordDisplay" -ForegroundColor White
    Write-Host "  Port:         $($global:Config.Port)" -ForegroundColor White
    Write-Host ""
    
    Write-Host "Repository:" -ForegroundColor $colors.Info
    Write-Host "  URL:          $($global:Config.RepoUrl)" -ForegroundColor White
    Write-Host ""
    
    Write-Host "Telegram API:" -ForegroundColor $colors.Info
    $apiIdDisplay = if ($global:Config.ApiId) { $global:Config.ApiId } else { "[NOT SET]" }
    
    if ($global:Config.ApiHash -and $global:Config.ApiHash.Length -gt 4) {
        $apiHashDisplay = "***" + $global:Config.ApiHash.Substring($global:Config.ApiHash.Length - 4)
    } elseif ($global:Config.ApiHash) {
        $apiHashDisplay = "***"
    } else {
        $apiHashDisplay = "[NOT SET]"
    }
    
    Write-Host "  API ID:       $apiIdDisplay" -ForegroundColor White
    Write-Host "  API Hash:     $apiHashDisplay" -ForegroundColor White
    Write-Host "  Channel:      $($global:Config.Channel)" -ForegroundColor White
    Write-Host ""
    
    Read-Host "Press Enter to continue"
}

function Show-Menu {
    Write-HD "FiatLux Docker Deploy Tool"
    Write-Host ""
    Write-Host "1. Setup Configuration"
    Write-Host "2. Edit Configuration"
    Write-Host "3. View Configuration"
    Write-Host "4. Verify Configuration"
    Write-Host "5. Deploy"
    Write-Host "6. Check Status"
    Write-Host "7. Update Code"
    Write-Host "8. Stop Service"
    Write-Host "9. Show Logs"
    Write-Host "D. Delete Container"
    Write-Host "0. Exit"
    Write-Host ""
}

function Setup-Config {
    Write-HD "Setup Configuration"
    Write-Host ""
    
    $global:Config.Server = Read-Host "Server IP or Domain"
    $global:Config.User = Read-Host "SSH User [ubuntu]"
    if ([string]::IsNullOrEmpty($global:Config.User)) { $global:Config.User = "ubuntu" }
    
    $global:Config.Password = Read-Host "SSH Password" -AsSecureString
    $global:Config.Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($global:Config.Password))
    
    $global:Config.RepoUrl = Read-Host "Repository URL"
    $global:Config.ApiId = Read-Host "Telegram API_ID"
    $global:Config.ApiHash = Read-Host "Telegram API_HASH"
    $global:Config.Channel = Read-Host "Channel Name [$($global:Config.Channel)]"
    if ([string]::IsNullOrEmpty($global:Config.Channel)) { $global:Config.Channel = "pat_cherkasyoblenergo" }
    
    Save-Config
    Write-OK "Configuration saved"
}

function Verify-Config {
    Write-HD "Verify Configuration"
    Write-Host ""
    
    $errors = @()
    
    if ([string]::IsNullOrEmpty($global:Config.Server)) { $errors += "Server not set" }
    if ([string]::IsNullOrEmpty($global:Config.RepoUrl)) { $errors += "Repository URL not set" }
    if ([string]::IsNullOrEmpty($global:Config.ApiId)) { $errors += "API_ID not set" }
    if ([string]::IsNullOrEmpty($global:Config.ApiHash)) { $errors += "API_HASH not set" }
    if (-not (Test-Path $global:Config.SSHKey)) { $errors += "SSH key not found" }
    
    if ($errors.Count -gt 0) {
        Write-ERR "Configuration errors:"
        $errors | ForEach-Object { Write-Host "  - $_" -ForegroundColor $colors.Error }
        Read-Host "Press Enter"
        return $false
    }
    
    Write-INF "Testing SSH connection..."
    $test = SSH-Run "echo OK"
    
    if ($test -like "*OK*") {
        Write-OK "SSH connection OK"
    } else {
        Write-ERR "SSH connection failed"
        Read-Host "Press Enter"
        return $false
    }
    
    Write-INF "Checking Docker..."
    $docker = SSH-Run "docker --version"
    
    if ($docker -like "*Docker*") {
        Write-OK "Docker installed"
    } else {
        Write-ERR "Docker not found"
        Read-Host "Press Enter"
        return $false
    }
    
    Write-OK "All checks passed"
    Read-Host "Press Enter"
    return $true
}

function Deploy {
    Write-HD "Deploy"
    Write-Host ""
    
    $confirm = Read-Host "Continue? (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    Write-INF "1. Creating directory..."
    SSH-Run "mkdir -p /opt/fiatlux" | Out-Null
    Write-OK "Done"
    
    Write-INF "2. Cloning repository..."
    $exists = SSH-Run "test -d /opt/fiatlux/.git && echo yes || echo no"
    
    if ($exists -like "*yes*") {
        SSH-Run "cd /opt/fiatlux && git pull" | Out-Null
        Write-OK "Updated"
    } else {
        SSH-Run "cd /opt/fiatlux && git clone $($global:Config.RepoUrl) ." | Out-Null
        Write-OK "Cloned"
    }
    
    Write-INF "3. Setting up .env..."
    $envCmd = @"
cat > /opt/fiatlux/.env << 'EOF'
API_ID=$($global:Config.ApiId)
API_HASH=$($global:Config.ApiHash)
CHANNEL_USERNAME=$($global:Config.Channel)
PORT=$($global:Config.Port)
HOST=0.0.0.0
LOG_LEVEL=info
EOF
"@
    SSH-Run $envCmd | Out-Null
    Write-OK "Done"
    
    Write-INF "4. Stopping containers..."
    SSH-Run "cd /opt/fiatlux && docker-compose down" | Out-Null
    Write-OK "Done"
    
    Write-INF "5. Building image..."
    SSH-Run "cd /opt/fiatlux && docker-compose build --no-cache" | Out-Null
    Write-OK "Done"
    
    Write-INF "6. Starting container..."
    SSH-Run "cd /opt/fiatlux && docker-compose up -d" | Out-Null
    Start-Sleep 3
    Write-OK "Done"
    
    Write-INF "7. Checking status..."
    $status = SSH-Run "docker ps | grep fiatlux"
    
    if ($status) {
        Write-OK "Container running"
    } else {
        Write-ERR "Container failed"
        $logs = SSH-Run "cd /opt/fiatlux && docker-compose logs --tail=10"
        Write-Host $logs -ForegroundColor $colors.Error
        Read-Host "Press Enter"
        return
    }
    
    Write-OK "Deployment complete!"
    Write-INF "Access: http://$($global:Config.Server):$($global:Config.Port)"
    Read-Host "Press Enter"
}

function Show-Status {
    Write-HD "Status"
    Write-Host ""
    
    $status = SSH-Run "docker ps --filter name=fiatlux"
    Write-Host $status
    
    Write-Host ""
    $logs = SSH-Run "cd /opt/fiatlux && docker-compose logs --tail=10"
    Write-Host $logs
    
    Read-Host "Press Enter"
}

function Update-Code {
    Write-HD "Update Code"
    Write-Host ""
    
    $confirm = Read-Host "Continue? (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    SSH-Run "cd /opt/fiatlux && git pull && docker-compose up -d --build" | Out-Null
    Write-OK "Updated"
    Read-Host "Press Enter"
}

function Stop-Svc {
    Write-HD "Stop Service"
    Write-Host ""
    
    $confirm = Read-Host "Stop? (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    SSH-Run "cd /opt/fiatlux && docker-compose stop" | Out-Null
    Write-OK "Stopped"
    Read-Host "Press Enter"
}

function Show-Logs {
    Write-HD "Logs"
    Write-Host ""
    Write-WRN "Press Ctrl+C to exit"
    Write-Host ""
    
    SSH-Run "cd /opt/fiatlux && docker-compose logs -f"
}

function Delete-Container {
    Write-HD "Delete Container"
    Write-Host ""
    
    $confirm = Read-Host "Delete? WARNING: Data will be lost (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    SSH-Run "cd /opt/fiatlux && docker-compose down -v" | Out-Null
    Write-OK "Deleted"
    Read-Host "Press Enter"
}

# Main Loop
Clear-Host
Write-Host "Welcome to FiatLux Docker Deployment Tool" -ForegroundColor $colors.Menu
Write-Host ""

# Load configuration at startup
Load-Config
Write-Host ""

do {
    Show-Menu
    $choice = Read-Host "Choose option"
    Clear-Host
    
    switch ($choice) {
        "1" { Setup-Config; Clear-Host }
        "2" { Setup-Config; Clear-Host }
        "3" { Show-Config; Clear-Host }
        "4" { Verify-Config; Clear-Host }
        "5" { Deploy; Clear-Host }
        "6" { Show-Status; Clear-Host }
        "7" { Update-Code; Clear-Host }
        "8" { Stop-Svc; Clear-Host }
        "9" { Show-Logs; Clear-Host }
        "D" { Delete-Container; Clear-Host }
        "d" { Delete-Container; Clear-Host }
        "0" { Write-Host "Goodbye!" -ForegroundColor $colors.Success; exit }
        default { Write-ERR "Invalid option"; Start-Sleep 1; Clear-Host }
    }
} while ($true)
