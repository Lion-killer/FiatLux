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

## 5. Перший запуск

```powershell
npm start
```

При першому запуску:
1. Введіть ваш номер телефону (з кодом країни, наприклад: +380991234567)
2. Введіть код з Telegram
3. Якщо потрібно, введіть пароль 2FA
4. Після успішної авторизації скопіюйте `SESSION_STRING` з консолі у `.env`

## 6. Перевірка роботи

Відкрийте браузер або використайте curl:

```powershell
# Перевірка здоров'я сервісу
curl http://localhost:8080/api/health

# Отримання поточного графіка
curl http://localhost:8080/api/schedule/current

# Отримання всіх графіків
curl http://localhost:8080/api/schedule/all
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
├── data/               # JSON файли з даними
│   └── schedules.json  # Збережені графіки
├── src/                # Вихідний TypeScript код
├── .env                # Ваша конфігурація (створити вручну)
└── package.json        # Опис проєкту
```

## Troubleshooting

### Помилка: "Cannot find module"
Виконайте `npm install`

### Помилка: "Missing required environment variable"
Перевірте `.env` файл та переконайтесь, що всі обов'язкові змінні заповнені

### Помилка авторизації Telegram
Видаліть `SESSION_STRING` з `.env` та спробуйте знову

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
