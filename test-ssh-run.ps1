# Test SSH-Run function
$ErrorActionPreference = "Continue"

# Colors
$colors = @{
    Success = "Green"
    Error = "Red"
    Warning = "Yellow"
    Info = "Cyan"
}

function Write-ERR {
    param([string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor $colors.Error
}

function Write-WRN {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor $colors.Warning
}

# Load config
$global:Config = @{
    Server = "192.168.50.10"
    User = "root"
    Password = "rasputin123"
}

# SSH-Run function
function SSH-Run {
    param([string]$Cmd)
    
    $sshTarget = "$($global:Config.User)@$($global:Config.Server)"
    
    # Force explicit check with Test-Path for executables
    $plinkAvailable = $false
    $sshAvailable = $false
    
    try {
        $null = Get-Command plink -ErrorAction Stop 2>$null
        $plinkAvailable = $true
    } catch { }
    
    try {
        $null = Get-Command ssh -ErrorAction Stop 2>$null
        $sshAvailable = $true
    } catch { }
    
    # DEBUG
    Write-Host "[DEBUG] SSH available: $sshAvailable, Plink available: $plinkAvailable, HasPassword: $(-not [string]::IsNullOrEmpty($global:Config.Password))" -ForegroundColor Yellow
    
    try {
        if ($plinkAvailable -and -not [string]::IsNullOrEmpty($global:Config.Password)) {
            # Use plink with password
            Write-Host "[DEBUG] Using plink with password" -ForegroundColor Yellow
            $result = & plink -batch -pw $global:Config.Password $sshTarget $Cmd 2>&1
        } elseif ($sshAvailable) {
            # Use standard ssh
            Write-Host "[DEBUG] Using ssh with BatchMode" -ForegroundColor Yellow
            $result = & ssh -o StrictHostKeyChecking=no -o BatchMode=yes $sshTarget $Cmd 2>&1
            
            # If BatchMode fails, inform user about SSH keys
            if ($LASTEXITCODE -ne 0 -and -not [string]::IsNullOrEmpty($global:Config.Password)) {
                Write-WRN "SSH key authentication failed. Password in config can't be used with OpenSSH."
                Write-WRN "Please setup SSH keys or install PuTTY for password authentication."
            }
        } else {
            Write-ERR "SSH/Plink not found. Please install OpenSSH or PuTTY."
            Write-WRN "Install OpenSSH: Settings > Apps > Optional Features > OpenSSH Client"
            return $null
        }
        return $result
    }
    catch {
        Write-ERR "SSH Error: $_"
        return $null
    }
}

# Test the function
Write-Host "`n=== Testing SSH-Run function ===" -ForegroundColor Green
Write-Host ""

$result = SSH-Run "echo 'Connection test successful'"

Write-Host ""
Write-Host "=== Result ===" -ForegroundColor Cyan
Write-Host "Output: $result"
Write-Host "Exit code: $LASTEXITCODE"
