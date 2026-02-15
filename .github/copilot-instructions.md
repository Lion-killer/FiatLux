# GitHub Copilot Instructions - FiatLux

## Project Overview

**FiatLux** is a Node.js/TypeScript service that monitors a Telegram channel (Cherkasyoblenergo) for power outage schedules and provides a web interface for viewing them.

### Core Functionality
- **Telegram Monitoring**: Connects to Telegram, retrieves messages from a channel
- **Schedule Parsing**: Extracts power outage schedules from Ukrainian text messages
- **Web Interface**: Displays schedules in an interactive timeline with queue selection
- **REST API**: Provides JSON endpoints for schedule data
- **In-Memory Storage**: Keeps current schedules in RAM (no persistence)

## Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3
- **Framework**: Express.js (API server)
- **Telegram**: GramJS (telegram library v2.24)
- **Frontend**: Vanilla JavaScript + HTML/CSS (no framework)
- **Deployment**: Docker + docker-compose
- **Environment**: dotenv for configuration

## Project Structure

```
src/
├── api/
│   └── server.ts          # Express API server with endpoints
├── config/
│   └── index.ts           # Environment variables configuration
├── parsers/
│   └── scheduleParser.ts  # Parse Ukrainian text to schedule objects
├── storage/
│   └── dataManager.ts     # In-memory schedule storage
├── telegram/
│   ├── client.ts          # TelegramChannelMonitor class
│   └── authManager.ts     # Web-based Telegram authentication
├── types/
│   └── schedule.ts        # TypeScript interfaces
├── utils/
│   ├── logger.ts          # Winston-like logger
│   └── envManager.ts      # .env file read/write utilities
└── index.ts               # Main entry point

public/
├── index.html             # Main web interface (timeline viewer)
└── setup.html             # Telegram setup wizard (3-step auth)

docs/
└── WEB_SETUP.md           # Documentation for web setup flow
```

## Code Style & Conventions

### TypeScript
- **Strict mode**: Enabled in tsconfig.json
- **Interfaces**: Prefer interfaces over types for object shapes
- **Explicit types**: Always specify return types for functions
- **Async/await**: Use async/await over promises (no .then() chains)
- **Error handling**: Always use try/catch in async functions

### Naming Conventions
- **Classes**: PascalCase (`TelegramChannelMonitor`, `DataManager`)
- **Functions/Methods**: camelCase (`parseMessage`, `getSchedule`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE`, `QUEUE_STORAGE_KEY`)
- **Files**: camelCase (`scheduleParser.ts`, `dataManager.ts`)
- **Interfaces**: PascalCase, no "I" prefix (`Schedule`, `Queue`, `TimeSlot`)

### Language
- **Comments**: Ukrainian (УКР)
- **User-facing text**: Ukrainian (УКР)
- **Code**: English (variable names, function names)
- **Logs**: Ukrainian for user messages, English for technical details
- **Commit messages**: Ukrainian (УКР)

Example:
```typescript
// Отримуємо графік на сьогодні
async function getCurrentSchedule(): Promise<Schedule | null> {
  try {
    logger.info('Завантаження актуального графіку...');
    return await dataManager.getCurrentSchedule();
  } catch (error) {
    logger.error('Failed to load schedule:', error);
    return null;
  }
}
```

## Key Architectural Patterns

### 1. Service Startup Modes
The service operates in three modes based on configuration:

- **Setup Mode**: No Telegram credentials → web interface only
- **Limited Mode**: Failed Telegram connection → web continues, can reconfigure
- **Normal Mode**: Full functionality with active Telegram monitoring

### 2. Data Flow
```
Telegram Channel → TelegramChannelMonitor → ScheduleParser → DataManager → API Server → Web UI
```

### 3. Schedule Parsing
- **Input**: Ukrainian text from Telegram messages
- **Pattern**: "Черга X.Y: HH:MM – HH:MM, HH:MM – HH:MM"
- **Output**: Structured JSON with queues, time slots, dates
- **Date Logic**: "Добовий графік" means 00:00-23:59:59 minus outages

### 4. Timeline Rendering
- **36-hour window**: 12 hours past ← NOW → 24 hours future
- **Three layers**:
  1. No-data periods (gray) - bottom
  2. Power-on periods (green) - middle
  3. Power-off periods (red) - top
- **Current time marker**: Purple vertical line at current moment

## Common Tasks & Patterns

### Adding a New API Endpoint

```typescript
// In src/api/server.ts
this.app.get('/api/new-endpoint', (req, res) => {
  try {
    // Отримуємо дані
    const data = this.dataManager.getSomeData();
    
    res.json({
      success: true,
      data: data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error in /api/new-endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});
```

### Parsing New Schedule Format

```typescript
// In src/parsers/scheduleParser.ts
private static parseCustomFormat(text: string): Schedule | null {
  // 1. Знайти дату
  const dateMatch = text.match(/\d{1,2}\s+\w+/);
  if (!dateMatch) return null;
  
  // 2. Розпарсити черги
  const queues = this.extractQueues(text);
  
  // 3. Створити об'єкт
  return {
    id: `${messageId}-${date}`,
    type: 'current',
    date: date,
    queues: queues,
    rawText: text,
    // ... інші поля
  };
}
```

### Adding New Frontend Feature

```javascript
// In public/index.html
async function fetchNewData() {
  try {
    const response = await fetch(`${API_BASE}/api/new-endpoint`);
    const data = await response.json();
    
    if (data.success) {
      updateUIWithNewData(data.data);
    } else {
      showError('Помилка завантаження даних');
    }
  } catch (error) {
    console.error('Помилка:', error);
    showError(`Помилка: ${error.message}`);
  }
}
```

## Important Gotchas

### 1. Date Handling
- **ВАЖЛИВО**: Use local timezone for schedule dates, not UTC
- Schedules are for local time in Ukraine (Kyiv timezone)
- Example: "15 лютого" means 2026-02-15 in local time

```typescript
// ПРАВИЛЬНО:
const scheduleDate = new Date(year, month, day, 0, 0, 0);

// НЕПРАВИЛЬНО:
const scheduleDate = new Date(Date.UTC(year, month, day));
```

### 2. Midnight Periods
- **Edge case**: "22:30 – 00:00" should NOT create a period on the next day
- Solution: Treat 00:00 as end of current day, not start of next

```typescript
if (endHour === 0 && endMinute === 0) {
  endHour = 23;
  endMinute = 59;
  endSecond = 59;
}
```

### 3. Telegram Authentication
- **Session persistence**: SESSION_STRING must be saved to .env
- **Web setup**: Users configure via browser, not terminal prompts
- **2FA Support**: Use `computeCheck` from `telegram/Password` module

### 4. Docker Volume Mounts
- **.env persistence**: MUST mount `./.env:/app/.env` in docker-compose
- Without volume mount, credentials are lost on container restart

## Testing Guidelines

### Manual Testing Checklist
- [ ] Service starts without credentials (Setup Mode)
- [ ] Web setup completes successfully (3 steps)
- [ ] .env file contains SESSION_STRING after setup
- [ ] Timeline displays schedules correctly
- [ ] Queue selector filters timeline
- [ ] Current time marker updates every second
- [ ] "До відключення" countdown works
- [ ] Container restart preserves credentials
- [ ] Old schedules marked as "past" (faded)

### Test API Endpoints
```bash
# Health check
curl http://localhost:8080/api/health

# Get all schedules
curl http://localhost:8080/api/schedule/all

# Setup status
curl http://localhost:8080/api/setup/status
```

## Environment Variables

Required for Normal Mode:
- `API_ID` - Telegram API ID (from my.telegram.org)
- `API_HASH` - Telegram API hash
- `SESSION_STRING` - Telegram session (auto-generated via web setup)
- `CHANNEL_USERNAME` - Telegram channel to monitor (e.g., `pat_cherkasyoblenergo`)

Optional:
- `PORT` - API server port (default: 8080)
- `HOST` - API server host (default: 0.0.0.0)
- `LOG_LEVEL` - Logging level (default: info)

## Deployment

### Local Development
```bash
npm install
npm run build
npm start
```

### Docker
```bash
docker-compose up -d
```

### Production
Use `deploy.ps1` script for interactive deployment to remote server.

## Security Considerations

- **No plaintext passwords in logs**: Always sanitize before logging
- **Session strings are sensitive**: Treat like passwords
- **API has no authentication**: Intended for internal network only
- **CORS**: Not configured - same-origin only

## Performance

- **Memory usage**: ~50-100MB for typical usage
- **CPU**: Minimal (< 1% idle, < 5% during parsing)
- **Network**: Persistent WebSocket to Telegram (low bandwidth)
- **Storage**: In-memory only, no disk I/O for schedules

## Known Issues & Limitations

1. **No persistence**: Schedules cleared on restart (by design)
2. **Single channel**: Only monitors one Telegram channel at a time
3. **Ukrainian only**: Parser works only with Ukrainian text
4. **No user auth**: Web interface is publicly accessible
5. **RAM-based**: Large history can increase memory usage

## When Writing Code for This Project

### DO:
- ✅ Write comments in Ukrainian for user-facing logic
- ✅ Use async/await consistently
- ✅ Handle errors gracefully with try/catch
- ✅ Log important events with appropriate levels
- ✅ Keep functions small and focused
- ✅ Use TypeScript types everywhere
- ✅ Test date/time logic carefully (timezone issues!)

### DON'T:
- ❌ Mix English and Ukrainian in user messages
- ❌ Use `.then()` chains (prefer async/await)
- ❌ Forget to handle 00:00 midnight edge case
- ❌ Save sensitive data to logs
- ❌ Create new files without discussing structure
- ❌ Add dependencies without checking package.json first

## Contact & Documentation

- **README.md**: General overview and quick start
- **docs/QUICKSTART.md**: Step-by-step setup guide
- **docs/WEB_SETUP.md**: Web-based Telegram authentication docs
- **docs/DEPLOY.md**: Complete deployment guide (deploy.ps1 + configuration)

## Version History

- **v1.0.0**: Initial release with web setup, timeline, and Telegram monitoring
- **Date logic**: Changed to daily schedules (00:00-23:59 minus outages)
- **Midnight fix**: Prevent 00:00 end time from creating next-day entries
- **Web setup**: Added browser-based Telegram authentication (3-step wizard)

---

**Last Updated**: February 2026
**Maintainer**: Project team
**License**: MIT
