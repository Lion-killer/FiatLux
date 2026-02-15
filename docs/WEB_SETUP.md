# Веб-налаштування FiatLux

## Огляд

FiatLux тепер підтримує веб-інтерфейс для першочергового налаштування Telegram API credentials та авторизації без необхідності ручного редагування файлів.

## Як це працює

### Перший запуск

1. **Запустіть сервіс:**
   ```bash
   docker-compose up -d
   # або
   npm start
   ```

2. **Автоматичне перенаправлення:**
   - Якщо `API_ID`, `API_HASH` або `SESSION_STRING` відсутні, головна сторінка автоматично перенаправить на `/setup.html`
   - Сервіс запуститься в режимі налаштування (Setup Mode)

3. **Процес налаштування:**

   **Крок 1: API Credentials**
   - Відвідайте https://my.telegram.org
   - Увійдіть у свій Telegram акаунт
   - Перейдіть в "API development tools"
   - Створіть нову застосунок
   - Скопіюйте `API ID` та `API Hash`
   - Введіть їх у веб-формі

   **Крок 2: Номер телефону**
   - Введіть свій номер телефону (+380...)
   - Натисніть "Надіслати код"
   - Telegram надішле вам код підтвердження

   **Крок 3: Код підтвердження**
   - Введіть код з Telegram
   - Якщо у вас увімкнена 2FA, буде запропоновано ввести пароль
   - Після успішної авторизації `SESSION_STRING` автоматично зберігається

4. **Завершення:**
   - Після успішного налаштування ви будете перенаправлені на головну сторінку
   - Сервіс автоматично підключиться до Telegram
   - Більше налаштування не потрібні!

## Технічні деталі

### API Endpoints

#### `GET /api/setup/status`
Перевіряє статус налаштування.

**Відповідь:**
```json
{
  "success": true,
  "data": {
    "configured": false,
    "hasApiCredentials": false,
    "hasSession": false
  }
}
```

#### `POST /api/setup/credentials`
Зберігає API credentials в `.env` файл.

**Запит:**
```json
{
  "apiId": "12345678",
  "apiHash": "abcdef1234567890..."
}
```

#### `POST /api/setup/auth/start`
Починає процес авторизації.

**Запит:**
```json
{
  "phoneNumber": "+380501234567"
}
```

**Відповідь:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session_xxx",
    "codeLength": 5
  }
}
```

#### `POST /api/setup/auth/code`
Підтверджує код верифікації.

**Запит:**
```json
{
  "sessionId": "session_xxx",
  "code": "12345"
}
```

**Відповідь (успіх):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "sessionString": "1AgAOMTQ5..."
  }
}
```

**Відповідь (потрібен 2FA):**
```json
{
  "success": true,
  "data": {
    "success": false,
    "needsPassword": true
  }
}
```

#### `POST /api/setup/auth/password`
Підтверджує 2FA пароль.

**Запит:**
```json
{
  "sessionId": "session_xxx",
  "password": "your_2fa_password"
}
```

### Збереження даних

- **API_ID** та **API_HASH** зберігаються в `.env` файлі в контейнері
- **SESSION_STRING** також зберігається в `.env` після успішної авторизації
- Всі зміни в `.env` відразу застосовуються до запущеного процесу
- В Docker контейнері `.env` файл зберігається в `/app/.env`

### Безпека

1. **Сесії авторизації:**
   - Активні сесії автоматично видаляються через 10 хвилин
   - Кожна сесія має унікальний ID
   - Після завершення авторизації сесія видаляється

2. **Credentials:**
   - API credentials і session string зберігаються тільки в `.env`
   - Не передаються клієнту через API (крім API_ID для перевірки)
   - Доступ до `/api/setup/*` можна обмежити через reverse proxy

3. **Логування:**
   - Всі спроби авторизації логуються
   - Паролі ніколи не логуються

## Режими роботи

### Setup Mode (Режим налаштування)
- Запускається якщо відсутні Telegram credentials
- Доступний тільки веб-інтерфейс налаштування
- Telegram monitoring НЕ активний
- API endpoints для schedule повертають порожні дані

### Limited Mode (Обмежений режим)
- Запускається якщо Telegram connection не вдалося
- Веб-інтерфейс працює
- Можна переналаштувати credentials через `/setup.html`
- API endpoints для schedule працюють з раніше збереженими даними

### Normal Mode (Нормальний режим)
- Всі credentials налаштовані
- Telegram monitoring активний
- Повна функціональність

## Повторне налаштування

Якщо потрібно змінити credentials:

1. Видаліть `SESSION_STRING` з `.env`:
   ```bash
   docker-compose exec fiatlux sh -c "sed -i '/^SESSION_STRING=/d' .env"
   ```

2. Перезапустіть контейнер:
   ```bash
   docker-compose restart
   ```

3. Відкрийте `/setup.html` і пройдіть процес заново

Або відредагуйте `.env` вручну і перезапустіть сервіс.

## Docker

### Volume для .env

✅ **Вже налаштовано!** У `docker-compose.yml` вже є mount для `.env`:

```yaml
volumes:
  - ./data:/app/data
  - ./.env:/app/.env  # Автоматично зберігає credentials між перезапусками
```

Це означає що:
- Веб-інтерфейс зберігає SESSION_STRING в `.env` всередині контейнера
- Зміни автоматично синхронізуються з `.env` на хості
- При перезапуску контейнера всі налаштування зберігаються
- Не потрібно нічого додатково налаштовувати!

## Troubleshooting

### Setup сторінка не відкривається

Перевірте що сервіс запущений:
```bash
curl http://localhost:3000/api/setup/status
```

### Помилка "Invalid credentials"

1. Перевірте що API_ID та API_HASH правильні на https://my.telegram.org
2. Переконайтеся що номер телефону введений з кодом країни
3. Перевірте логи: `docker-compose logs -f fiatlux`

### Session не зберігається

Перевірте права доступу до `.env`:
```bash
docker-compose exec fiatlux ls -la /app/.env
```

Має бути доступним для запису.

### Telegram не підключається після setup

1. Перевірте що `.env` містить SESSION_STRING:
   ```bash
   docker-compose exec fiatlux cat /app/.env | grep SESSION_STRING
   ```

2. Перезапустіть контейнер:
   ```bash
   docker-compose restart
   ```

3. Якщо не допомагає - видаліть SESSION_STRING і пройдіть setup знову

## Інтеграція з існуючим проектом

Якщо ви вже налаштували `.env` вручну, веб-інтерфейс це визначить і перенаправить на головну сторінку. Налаштування не потрібні.

Для примусового відкриття setup сторінки:
```
http://localhost:3000/setup.html
```
