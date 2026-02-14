# Deployment Configuration Guide

## Quick Start

1. **First Time Setup:**
   - Run `.\deploy-interactive.ps1`
   - Choose option **1. Setup Configuration**
   - Enter your server details
   - Configuration is automatically saved to `.deploy-config.env`

2. **View Configuration:**
   - Run the script
   - Choose option **3. View Configuration**
   - API Hash will be masked (shows only last 4 characters)

3. **Edit Configuration:**
   - Run the script
   - Choose option **2. Edit Configuration**
   - Update any values
   - Configuration is saved automatically

## Configuration File Format

The `.deploy-config.env` file stores deployment settings in KEY=VALUE format:

```ini
# FiatLux Deployment Configuration

# Server Settings
DEPLOY_SERVER=192.168.1.100        # Your server IP or hostname
DEPLOY_USER=ubuntu                  # SSH username
DEPLOY_PASSWORD=your_password_here  # SSH password
DEPLOY_PORT=3000                    # Application port

# Repository
DEPLOY_REPO_URL=https://github.com/your-username/FiatLux.git

# Telegram API (get from https://my.telegram.org)
API_ID=12345678
API_HASH=your_api_hash_here
CHANNEL_USERNAME=pat_cherkasyoblenergo
```

## Security

⚠️ **IMPORTANT:** The `.deploy-config.env` file is automatically ignored by git (already in `.gitignore`).

- **Never commit this file to version control**
- Contains sensitive data: passwords, API credentials
- Each developer should maintain their own copy

## SSH Connection

The script supports password-based SSH authentication using standard commands:

### Automatic Mode (Recommended)
- **plink** (PuTTY): Automatically uses `-pw` parameter for passwordless automation
- Download: [PuTTY](https://www.putty.org/)
- After installation, add plink to your PATH

### Interactive Mode
- **Standard ssh**: Uses built-in Windows OpenSSH
- Will prompt for password when needed
- No additional software required

### Which One to Use?

| Tool | Pros | Cons |
|------|------|------|
| **plink** | ✅ Fully automated<br>✅ No password prompts<br>✅ Batch operations | ⚠️ Requires PuTTY installation |
| **ssh** | ✅ Built-in to Windows<br>✅ No installation needed | ⚠️ May prompt for password<br>⚠️ Less suitable for automation |

## Configuration Validation

After setup, use option **4. Verify Configuration** to test:
- SSH connection to server
- Git repository access  
- Required tools (Docker, docker-compose)

## Troubleshooting

**Configuration not loading?**
- Check file exists: `.deploy-config.env` in project root
- Verify file format (KEY=VALUE, no spaces around =)
- Lines starting with `#` are comments

**API Hash showing as [NOT SET]?**
- Get credentials from https://my.telegram.org
- Go to "API development tools"
- Create an application to get API_ID and API_HASH

**SSH connection fails?**
- Verify server IP and username are correct
- Test password by connecting manually: `ssh user@server`
- For automated access, consider installing plink: [PuTTY Download](https://www.putty.org/)
- Standard ssh may prompt for password interactively

## Example .deploy-config.env

```ini
DEPLOY_SERVER=192.168.1.100
DEPLOY_USER=ubuntu
DEPLOY_PASSWORD=MySecurePassword123
DEPLOY_PORT=3000
DEPLOY_REPO_URL=https://github.com/your-username/FiatLux.git
API_ID=34405296
API_HASH=b1b057965806f8ecadbf5fab65272b3e
CHANNEL_USERNAME=pat_cherkasyoblenergo
```

## Manual Configuration

If you prefer to create the configuration file manually:

1. Copy `.deploy-config.env.example` to `.deploy-config.env`
2. Edit values in the new file
3. Save and run the deployment script
4. Configuration will load automatically

## Configuration Keys Reference

| Key | Description | Example |
|-----|-------------|---------|
| `DEPLOY_SERVER` | Server IP or hostname | `192.168.1.100` |
| `DEPLOY_USER` | SSH username | `ubuntu` |
| `DEPLOY_PASSWORD` | SSH password | `your_password` |
| `DEPLOY_PORT` | Application listening port | `3000` |
| `DEPLOY_REPO_URL` | Git repository URL | `https://github.com/...` |
| `API_ID` | Telegram API ID | `12345678` |
| `API_HASH` | Telegram API Hash | `abc123...` |
| `CHANNEL_USERNAME` | Telegram channel to monitor | `pat_cherkasyoblenergo` |
