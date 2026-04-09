# 🚀 Деплой FiatLux на сервер

Повний гайд з деплою FiatLux на віддалений сервер через Docker.

## ⚡ Швидкий старт

```powershell
.\deploy.ps1
```

1. **Опція 1** — Введіть IP сервера та SSH користувача
2. **Опція K** — Налаштуйте SSH ключі (пароль потрібен один раз)
3. **Опція 3** — Перевірте конфігурацію
4. **Опція 4** — Deploy
5. **Відкрийте** `http://<server-ip>:8080/setup.html` — введіть Telegram credentials через веб-інтерфейс

---

## 📋 Вимоги

### На локальній машині (Windows)
- Windows 10/11 з PowerShell 5.1+
- OpenSSH Client (зазвичай встановлений за замовчуванням)
  - Якщо ні: Settings → Apps → Optional Features → "OpenSSH Client"
  - Або через PowerShell (адміністратор): `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0`

### На сервері (Linux)
- Ubuntu 20.04+ або інший Linux
- Docker та docker-compose
- SSH доступ

---

## 🔧 Конфігурація

### Автоматична (рекомендовано)
Запустіть `.\deploy.ps1` і виберіть опцію **1. Setup Configuration**.

### Ручна
Створіть файл `.deploy-config.env` в корені проекту:

```ini
# Server Settings
DEPLOY_SERVER=192.168.1.100
DEPLOY_USER=root
DEPLOY_PORT=8080

# Repository
DEPLOY_REPO_URL=https://github.com/Lion-killer/FiatLux.git

# Telegram Channel
CHANNEL_USERNAME=pat_cherkasyoblenergo
```

> ⚠️ Файл `.deploy-config.env` є в `.gitignore`. **Ніколи не комітьте його** в git — містить чутливі дані сервера.

---

## 🔑 SSH Ключі

OpenSSH не підтримує передачу пароля через командний рядок — потрібні SSH ключі.

### Автоматично (рекомендовано)

1. Запустіть `.\deploy.ps1`
2. Виберіть **K. Setup SSH Keys**
3. Скрипт згенерує RSA-4096 ключ (якщо немає) і скопіює на сервер
4. Пароль потрібен **один раз** — далі все автоматично

### Вручну

```powershell
ssh-keygen -t rsa -b 4096
type $env:USERPROFILE\.ssh\id_rsa.pub | ssh user@server "cat >> ~/.ssh/authorized_keys"
```

---

## 🚀 Використання deploy.ps1

### Головне меню

| Опція | Дія |
|-------|-----|
| `1` | Setup Configuration — IP сервера та SSH користувач |
| `2` | View Configuration — переглянути поточну конфігурацію |
| `3` | Verify Configuration — перевірити SSH та Docker |
| `K` | Setup SSH Keys — налаштувати SSH ключі |
| `4` | Deploy — повний деплой (або оновлення) |
| `5` | Check Status — статус контейнера та останні логи |
| `6` | Start Service — запустити зупинений контейнер |
| `7` | Stop Service — зупинити сервіс |
| `8` | Show Logs — логи в реальному часі |
| `D` | Delete Container — видалити контейнер та всі дані |
| `0` | Exit |

### Типовий workflow

```
# Перший запуск
1 → IP сервера та SSH User
K → SSH ключі (пароль один раз)
3 → Перевірка
4 → Deploy

# Наступні оновлення — просто:
4 → Deploy (автоматично git pull + rebuild)

# Моніторинг:
5 → Status
8 → Logs
```

### Опції меню (детально)

#### 1. Setup Configuration
Запитує і зберігає IP/домен сервера та SSH користувача.

#### 2. View Configuration
Відображає поточні налаштування: сервер, користувач, порт, репозиторій, канал.

#### 3. Verify Configuration
Перевіряє SSH з'єднання і наявність Docker на сервері.

#### K. Setup SSH Keys
- Генерує RSA-4096 ключ якщо відсутній
- Копіює публічний ключ на сервер (пароль один раз)
- Після цього всі SSH команди працюють без пароля

#### 4. Deploy
При першому запуску клонує репозиторій, при повторному — виконує `git pull`.

1. Створює `/opt/fiatlux` на сервері
2. Клонує або оновлює репозиторій
3. Зупиняє старі контейнери
4. Зберігає наявні Telegram credentials (API_ID, API_HASH, SESSION_STRING) між деплоями
5. Будує Docker образ
6. Запускає контейнер

#### 5. Check Status
Показує статус контейнерів та останні 20 рядків логів.

#### 6. Start Service
Запускає зупинений контейнер (`docker compose up -d`).

#### 7. Stop Service
Зупиняє контейнер (`docker compose stop`).

#### 8. Show Logs
Логи в реальному часі. Ctrl+C для виходу.

#### D. Delete Container
⚠️ **Незворотньо!** Видаляє контейнер і volumes. Вимагає підтвердження.

---

## 🔐 Безпека

### Firewall на сервері

```bash
sudo ufw allow ssh
sudo ufw allow 8080/tcp
sudo ufw enable
```

### Nginx reverse proxy (рекомендовано)

```bash
sudo apt install nginx
sudo nano /etc/nginx/sites-available/fiatlux
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/fiatlux /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### SSL (Let's Encrypt)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 🐛 Troubleshooting

### "ssh-keygen not found"
OpenSSH Client не встановлений. Встановіть через Settings → Apps → Optional Features → "OpenSSH Client", або:
```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

### "SSH connection failed"
```powershell
# Перевірте SSH ключ
Test-Path $env:USERPROFILE\.ssh\id_rsa
# Якщо ні — виберіть K (Setup SSH Keys)
```

### "Docker not installed"
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

### "Container not starting"
Перегляньте логи (опція **8**) або вручну:
```bash
ssh user@server "cd /opt/fiatlux && docker compose logs --tail=100"
```

### "Telegram authentication error"
```bash
# Видаліть сесію і пройдіть web setup заново
ssh user@server "docker compose exec fiatlux sh -c \"sed -i '/^SESSION_STRING=/d' .env\""
ssh user@server "cd /opt/fiatlux && docker compose restart"
# Відкрийте http://<server>:8080/setup.html
```

---

## 📞 Корисні команди на сервері

```bash
cd /opt/fiatlux
docker compose logs -f       # Логи в реальному часі
docker compose ps             # Статус
docker compose restart        # Перезапуск
docker compose down           # Зупинка
docker compose up -d          # Запуск
docker compose down -v        # Видалення (з даними)
```

---

## 📖 Додаткові ресурси

- [QUICKSTART.md](QUICKSTART.md) — Локальна розробка
- [WEB_SETUP.md](WEB_SETUP.md) — Налаштування Telegram через веб
- [README.md](../README.md) — Загальний огляд
