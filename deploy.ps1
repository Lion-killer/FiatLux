# FiatLux Docker Deployment Tool for Windows
# Interactive deployment

$ErrorActionPreference = "Continue"

# Colors
$colors = @{
    Success = "Green"
    Error   = "Red"
    Warning = "Yellow"
    Info    = "Cyan"
    Menu    = "Magenta"
}

# Global Config
$global:Config = @{
    Server  = ""
    Port    = 8080
    User    = "root"
    RepoUrl = "https://github.com/Lion-killer/FiatLux.git"
    Channel = "pat_cherkasyoblenergo"
}

$global:ConfigFile = ".\.deploy-config.env"
$global:SSHKeyWarningShown = $false

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
    $sshExe = "C:\Windows\System32\OpenSSH\ssh.exe"
    
    # Режим UTF8 для коректного відображення символів
    $OutputEncoding = [System.Text.Encoding]::UTF8

    try {
        $result = & $sshExe -n -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 $sshTarget $Cmd 2>&1
        $exitCode = $LASTEXITCODE
        
        # Exit code 255 = SSH connection error (not a remote command error)
        if ($exitCode -eq 255 -and -not $global:SSHKeyWarningShown) {
            $errText = ($result | Out-String)
            Write-Host ""
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host "  SSH CONNECTION ERROR" -ForegroundColor Yellow
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host ""
            if ($errText -match "Permission denied") {
                Write-Host "SSH keys are not configured for this server." -ForegroundColor White
                Write-Host "Return to main menu and select 'K' to setup SSH keys." -ForegroundColor Green
            }
            elseif ($errText -match "Connection refused|Connection timed out|No route to host") {
                Write-Host "Cannot connect to $($global:Config.Server)" -ForegroundColor White
                Write-Host "Check that the server is online and accessible." -ForegroundColor Green
            }
            else {
                Write-Host $errText -ForegroundColor White
            }
            Write-Host "========================================" -ForegroundColor Yellow
            Write-Host ""
            $global:SSHKeyWarningShown = $true
            Read-Host "Press Enter to continue"
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
                        "DEPLOY_USER" { if ($value) { $global:Config.User = $value } }
                        "DEPLOY_REPO_URL" { if ($value) { $global:Config.RepoUrl = $value } }
                        "DEPLOY_PORT" { if ($value) { $global:Config.Port = [int]$value } }
                        "CHANNEL_USERNAME" { if ($value) { $global:Config.Channel = $value } }
                    }
                }
            }
        }
        
        Write-OK "Configuration loaded"
    }
    else {
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
DEPLOY_PORT=$($global:Config.Port)

# Repository
DEPLOY_REPO_URL=$($global:Config.RepoUrl)

# Telegram Channel
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
    Write-Host "  Port:         $($global:Config.Port)" -ForegroundColor White
    Write-Host "  Auth:         SSH Key" -ForegroundColor White
    Write-Host ""
    
    Write-Host "Repository:" -ForegroundColor $colors.Info
    Write-Host "  URL:          $($global:Config.RepoUrl)" -ForegroundColor White
    Write-Host ""
    
    Write-Host "Telegram:" -ForegroundColor $colors.Info
    Write-Host "  Channel:      $($global:Config.Channel)" -ForegroundColor White
    Write-Host "  API/Auth:     (configured via web interface)" -ForegroundColor Gray
    Write-Host ""
    
    Read-Host "Press Enter to continue"
}
function Setup-SSHKeys {
    Write-HD "Setup SSH Keys"
    Write-Host ""
    Write-Host "SSH Keys allow password-less login to server." -ForegroundColor $colors.Info
    Write-Host "This is secure and convenient for automation." -ForegroundColor $colors.Info
    Write-Host ""
    
    $sshDir = "$env:USERPROFILE\.ssh"
    $keyFile = "$sshDir\id_rsa"
    $pubKeyFile = "$keyFile.pub"
    $keyFileUnix = $keyFile -replace '\\', '/'
    
    # Check if key already exists
    $generateKey = $false
    if (Test-Path $pubKeyFile) {
        Write-OK "SSH key already exists: $pubKeyFile"
        Write-Host ""
        
        # Перевірити чи ключ вже працює на сервері
        if (-not [string]::IsNullOrEmpty($global:Config.Server)) {
            $sshTarget = $global:Config.User + '@' + $global:Config.Server
            Write-Host "Testing SSH key authentication to $sshTarget..." -ForegroundColor $colors.Info
            $batFile = Join-Path $env:TEMP "fiatux-ssh-test.bat"
            Set-Content -Path $batFile -Value "@echo off`r`nssh.exe -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=5 $sshTarget echo OK" -Encoding ASCII
            $testResult = & cmd.exe /c $batFile 2>&1
            Remove-Item $batFile -ErrorAction SilentlyContinue
            
            if ($LASTEXITCODE -eq 0) {
                Write-OK "SSH key authentication works! No password needed."
                Write-Host ""
                Read-Host "Press Enter to continue"
                return
            }
            else {
                Write-WRN "SSH key not yet configured on server"
            }
        }
        
        Write-Host ""
        Write-Host "Public key content:" -ForegroundColor $colors.Info
        Get-Content $pubKeyFile | Write-Host -ForegroundColor White
        Write-Host ""
        
        Write-Host "Options:" -ForegroundColor $colors.Info
        Write-Host "  C - Copy key to server" -ForegroundColor White
        Write-Host "  R - Regenerate key and copy to server" -ForegroundColor White
        Write-Host "  0 - Back to main menu" -ForegroundColor White
        Write-Host ""
        $action = Read-Host "Choose (C/R/0) [C]"
        
        if ($action -eq 'R' -or $action -eq 'r') {
            Remove-Item $keyFile -ErrorAction SilentlyContinue
            Remove-Item $pubKeyFile -ErrorAction SilentlyContinue
            $generateKey = $true
        }
        elseif ($action -eq '0') {
            return
        }
        # Інакше (C або Enter) — переходимо до копіювання
    }
    else {
        $generateKey = $true
    }
    
    if ($generateKey) {
        Write-WRN "Generating new SSH key..."
        Write-Host ""
        
        # Create .ssh directory if not exists
        if (-not (Test-Path $sshDir)) {
            New-Item -ItemType Directory -Path $sshDir | Out-Null
        }
        
        # Створити .bat файл для генерації ключа (правильно передає порожній passphrase)
        $batFile = Join-Path $env:TEMP "fiatux-keygen.bat"
        Set-Content -Path $batFile -Value "@echo off`r`nssh-keygen.exe -t rsa -b 4096 -f `"$keyFileUnix`" -N `"`"" -Encoding ASCII
        & cmd.exe /c $batFile
        Remove-Item $batFile -ErrorAction SilentlyContinue
        
        if ($LASTEXITCODE -eq 0 -and (Test-Path $pubKeyFile)) {
            Write-OK "SSH key generated successfully (without passphrase)!"
            Write-Host ""
            Write-Host "Public key content:" -ForegroundColor $colors.Info
            Get-Content $pubKeyFile | Write-Host -ForegroundColor White
            Write-Host ""
        }
        else {
            Write-ERR 'Failed to generate SSH key'
            Read-Host "Press Enter"
            return
        }
    }
    
    # Copy to server
    Write-Host ""
    Write-Host "Now we will copy the key to your server..." -ForegroundColor $colors.Info
    Write-Host "You will need to enter your server password ONE LAST TIME." -ForegroundColor $colors.Warning
    Write-Host ""
    
    $serverInfo = $global:Config.User + '@' + $global:Config.Server
    $confirmPrompt = "Copy key to " + $serverInfo + "? (y/n)"
    $confirm = Read-Host $confirmPrompt
    
    if ($confirm -eq 'y') {
        Write-Host ""
        Write-Host "Running: ssh-copy-id (manual simulation for Windows)..." -ForegroundColor $colors.Info
        
        $pubKey = (Get-Content $pubKeyFile).Trim()
        $sshTarget = $global:Config.User + '@' + $global:Config.Server
        
        Write-Host ""
        Write-Host "Please enter your server password when prompted:" -ForegroundColor $colors.Warning
        Write-Host ""
        
        try {
            # Використовуємо plink якщо є пароль, інакше ssh через .bat файл
            $plinkPath = (Get-Command plink.exe -ErrorAction SilentlyContinue).Source
            
            if ($plinkPath -and -not [string]::IsNullOrEmpty($global:Config.Password)) {
                # Через plink з паролем
                $remoteCmd = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$pubKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
                $result = & $plinkPath -batch -pw $global:Config.Password $sshTarget $remoteCmd 2>&1
            }
            else {
                # Створити тимчасовий .bat файл — надійно резолвить PATH і правильно передає аргументи
                $batFile = Join-Path $env:TEMP "fiatux-ssh-copy.bat"
                $batContent = "@echo off`r`nssh.exe -o StrictHostKeyChecking=no $sshTarget `"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$pubKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`""
                Set-Content -Path $batFile -Value $batContent -Encoding ASCII
                & cmd.exe /c $batFile
                Remove-Item $batFile -ErrorAction SilentlyContinue
            }
            
            if ($LASTEXITCODE -eq 0) {
                Write-OK "SSH key copied successfully!"
                Write-Host ""
                Write-Host 'You can now connect without password!' -ForegroundColor $colors.Success
                Write-Host 'You can remove DEPLOY_PASSWORD from config file' -ForegroundColor $colors.Info
            }
            else {
                Write-ERR 'Failed to copy SSH key'
            }
        }
        catch {
            Write-ERR ('Error: ' + $_)
        }
    }
    
    Write-Host ""
    Read-Host "Press Enter to continue"
}


function Show-Menu {
    Write-HD "FiatLux Docker Deploy Tool"
    Write-Host ""
    Write-Host "1. Setup Configuration"
    Write-Host "2. View Configuration"
    Write-Host "3. Verify Configuration"
    Write-Host "K. Setup SSH Keys (Recommended)" -ForegroundColor $colors.Success
    Write-Host "4. Deploy"
    Write-Host "5. Check Status"
    Write-Host "6. Update Code"
    Write-Host "7. Stop Service"
    Write-Host "8. Show Logs"
    Write-Host "D. Delete Container"
    Write-Host "0. Exit"
    Write-Host ""
}

function Setup-Config {
    Write-HD "Setup Configuration"
    Write-Host ""
    
    $input = Read-Host "Server IP or Domain [$($global:Config.Server)]"
    if (-not [string]::IsNullOrEmpty($input)) { $global:Config.Server = $input }
    
    $input = Read-Host "SSH User [$($global:Config.User)]"
    if (-not [string]::IsNullOrEmpty($input)) { $global:Config.User = $input }
    
    Save-Config
    Write-OK "Configuration saved"
}

function Verify-Config {
    Write-HD "Verify Configuration"
    Write-Host ""
    
    $errors = @()
    
    if ([string]::IsNullOrEmpty($global:Config.Server)) { $errors += "Server not set" }
    if ([string]::IsNullOrEmpty($global:Config.RepoUrl)) { $errors += "Repository URL not set" }
    
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
    }
    else {
        Write-ERR "SSH connection failed"
        Read-Host "Press Enter"
        return $false
    }
    
    Write-INF "Checking Docker..."
    $docker = SSH-Run "docker --version"
    
    if ($docker -like "*Docker*") {
        Write-OK "Docker installed"
    }
    else {
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
    
    Write-Host "  Target:  $($global:Config.User)@$($global:Config.Server)" -ForegroundColor Cyan
    Write-Host "  Repo:    $($global:Config.RepoUrl)" -ForegroundColor Cyan
    Write-Host "  Channel: $($global:Config.Channel)" -ForegroundColor Cyan
    Write-Host ""
    
    $confirm = Read-Host "Continue? (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    Write-Host ""
    Write-INF "1. Connecting to $($global:Config.Server)..."
    $testResult = SSH-Run "echo ok"
    if ($testResult -notlike "*ok*") {
        Write-ERR "Cannot connect to $($global:Config.Server)"
        Read-Host "Press Enter"
        return
    }
    Write-OK "Connected to $($global:Config.Server)"
    
    Write-INF "2. Creating directory..."
    SSH-Run "mkdir -p /opt/fiatlux" | Out-Null
    Write-OK "Done"
    
    Write-INF "3. Cloning repository..."
    $exists = SSH-Run 'test -d /opt/fiatlux/.git && echo yes || echo no'
    
    if ($exists -like "*yes*") {
        SSH-Run 'cd /opt/fiatlux && git pull' | Out-Null
        Write-OK "Updated"
    }
    else {
        $cloneCmd = 'cd /opt/fiatlux && git clone ' + $global:Config.RepoUrl + ' .'
        SSH-Run $cloneCmd | Out-Null
        Write-OK "Cloned"
    }
    
    Write-INF "4. Stopping containers..."
    SSH-Run 'cd /opt/fiatlux && docker compose down' | Out-Null
    Write-OK "Done"

    Write-INF "5. Setting up .env..."
    $bashScript = @"
cd /opt/fiatlux
if [ -d .env ]; then rm -rf .env; fi
API_ID_VAL=`$(grep '^API_ID=' .env 2>/dev/null | cut -d= -f2- || echo '')
API_HASH_VAL=`$(grep '^API_HASH=' .env 2>/dev/null | cut -d= -f2- || echo '')
SESSION_VAL=`$(grep '^SESSION_STRING=' .env 2>/dev/null | cut -d= -f2- || echo '')
printf 'CHANNEL_USERNAME=$($global:Config.Channel)\nPORT=$($global:Config.Port)\nHOST=0.0.0.0\nLOG_LEVEL=info\n' > .env
if [ -n "`$API_ID_VAL" ]; then printf 'API_ID=%s\n' "`$API_ID_VAL" >> .env; fi
if [ -n "`$API_HASH_VAL" ]; then printf 'API_HASH=%s\n' "`$API_HASH_VAL" >> .env; fi
if [ -n "`$SESSION_VAL" ]; then printf 'SESSION_STRING=%s\n' "`$SESSION_VAL" >> .env; fi
"@

    $sanitizedCmd = $bashScript -replace "`r`n", "; " -replace "`n", "; "
    SSH-Run $sanitizedCmd | Out-Null
    Write-OK "Done"
    
    Write-INF "6. Building image..."
    SSH-Run 'cd /opt/fiatlux && docker compose build --no-cache' | Out-Null
    Write-OK "Done"
    
    Write-INF "7. Starting container..."
    SSH-Run 'cd /opt/fiatlux && docker compose up -d' | Out-Null
    Start-Sleep 3
    Write-OK "Done"
    
    Write-INF "8. Checking status..."
    $status = SSH-Run 'docker ps | grep fiatlux'
    
    if ($status) {
        Write-OK "Container running"
    }
    else {
        Write-ERR "Container failed"
        $logs = SSH-Run 'cd /opt/fiatlux && docker compose logs --tail=10'
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
    
    $status = SSH-Run 'docker ps --filter name=fiatlux'
    Write-Host $status
    
    Write-Host ""
    $logs = SSH-Run 'cd /opt/fiatlux && docker compose logs --tail=10'
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
    
    SSH-Run 'cd /opt/fiatlux && git pull && docker compose up -d --build' | Out-Null
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
    
    SSH-Run 'cd /opt/fiatlux && docker compose stop' | Out-Null
    Write-OK "Stopped"
    Read-Host "Press Enter"
}

function Show-Logs {
    Write-HD "Logs"
    Write-Host ""
    Write-WRN "Press Ctrl+C to exit"
    Write-Host ""
    
    SSH-Run 'cd /opt/fiatlux && docker compose logs -f'
}

function Delete-Container {
    Write-HD "Delete Container"
    Write-Host ""
    
    $confirm = Read-Host "Delete? WARNING: Data will be lost (y/n)"
    if ($confirm -ne "y") {
        Write-WRN "Cancelled"
        return
    }
    
    SSH-Run 'cd /opt/fiatlux && docker compose down -v' | Out-Null
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
        "1" { Setup-Config; Clear-Host; break }
        "2" { Show-Config; Clear-Host; break }
        "3" { Verify-Config; Clear-Host; break }
        { $_ -eq "K" -or $_ -eq "k" } { Setup-SSHKeys; Clear-Host; break }
        "4" { Deploy; Clear-Host; break }
        "5" { Show-Status; Clear-Host; break }
        "6" { Update-Code; Clear-Host; break }
        "7" { Stop-Svc; Clear-Host; break }
        "8" { Show-Logs; Clear-Host; break }
        { $_ -eq "D" -or $_ -eq "d" } { Delete-Container; Clear-Host; break }
        "0" { Write-Host 'Goodbye!' -ForegroundColor $colors.Success; exit }
        default { Write-ERR 'Invalid option'; Start-Sleep 1; Clear-Host }
    }
} while ($true)
