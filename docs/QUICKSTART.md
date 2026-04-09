# Швидкий старт FiatLux

## 1. Встановлення залежностей
```powershell
npm install
```

## 2. Налаштування .env файлу

Створіть `.env` файл на основі `.env.example`:
```powershell
Copy-Item .env.example .env
```

Відредагуйте `.env` та додайте ваші Telegram credentials:
```env
API_ID=12345678
API_HASH=your_api_hash_here
SESSION_STRING=
CHANNEL_USERNAME=cherkasyoblenergo
PORT=8080
```

## 3. Отримання Telegram API credentials

1. Відкрийте https://my.telegram.org
2. Увійдіть з вашим номером телефону
3. Перейдіть в "API development tools"
4. Створіть нову аплікацію
5. Скопіюйте `api_id` та `api_hash`

## 4. Компіляція TypeScript

```powershell
npm run build
```

## 5. Перший запуск та авторизація Telegram

```powershell
npm start
```

Відкрийте `http://localhost:8080/setup.html` і пройдіть авторизацію через веб-інтерфейс (API credentials + номер телефону + код з Telegram).

## 6. Перевірка роботи

Відкрийте браузер або використайте curl:

```powershell
# Перевірка здоров'я сервісу
curl http://localhost:8080/api/health

# Отримання поточного графіка
curl http://localhost:8080/api/schedule/current

# Отримання всіх графіків
curl http://localhost:8080/api/schedule/all

# Інтерактивна документація (рекомендовано)
# Відкрийте у браузері: http://localhost:8080/docs
```

## 7. Примусове оновлення даних

```powershell
curl -X POST http://localhost:8080/api/refresh
```

## Структура проєкту після встановлення

```
FiatLux/
├── node_modules/        # Встановлені залежності
├── dist/               # Скомпільований JavaScript
├── src/                # Вихідний TypeScript код
├── .env                # Ваша конфігурація (створити вручну)
└── package.json        # Опис проєкту
```

> Дані зберігаються в пам'яті (in-memory) і не записуються у файли.

## Troubleshooting

### Помилка: "Cannot find module"
Виконайте `npm install`

### Помилка: "Missing required environment variable"
Перевірте `.env` файл та переконайтесь, що всі обов'язкові змінні заповнені

### Помилка авторизації Telegram
Видаліть `SESSION_STRING` з `.env` і пройдіть web setup заново (`/setup.html`)

### Порт зайнятий
Змініть `PORT` в `.env` на інше значення

## Корисні команди

```powershell
# Development режим з автоматичною перекомпіляцією
npm run dev

# Очистити збірку
npm run clean

# Переглянути логи з детальною інформацією
$env:LOG_LEVEL="debug"; npm start
```

## Docker (опціонально)

```powershell
# Збудувати образ
docker-compose build

# Запустити сервіс
docker-compose up -d

# Переглянути логи
docker-compose logs -f

# Зупинити сервіс
docker-compose down
```
