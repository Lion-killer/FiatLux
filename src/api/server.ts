import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { ApiResponse, HealthStatus, ITelegramMonitor } from '../types';
import { DataManager } from '../storage/dataManager';
import { ScheduleParser } from '../parsers/scheduleParser';
import { logger } from '../utils/logger';
import { EnvManager } from '../utils/envManager';
import { TelegramAuthManager } from '../telegram/authManager';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

export class ApiServer {
  private app: express.Application;
  private dataManager: DataManager;
  private telegramMonitor: ITelegramMonitor;
  private envManager: EnvManager;
  private authManager: TelegramAuthManager;
  private startTime: number = Date.now();
  private lastMessageCheck?: string;

  constructor(dataManager: DataManager, telegramMonitor: ITelegramMonitor) {
    this.app = express();
    this.dataManager = dataManager;
    this.telegramMonitor = telegramMonitor;
    this.envManager = new EnvManager();
    this.authManager = new TelegramAuthManager();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();

    // Clean up old auth sessions every 5 minutes
    setInterval(() => this.authManager.cleanupOldSessions(), 5 * 60 * 1000);
  }

  /** Replace the Telegram monitor (e.g. placeholder → real client after connect) */
  setTelegramMonitor(monitor: ITelegramMonitor): void {
    this.telegramMonitor = monitor;
  }

  private setupMiddleware(): void {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    // Parse JSON bodies
    this.app.use(express.json());

    // CORS
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    /**
     * @swaggerOptions
     * Swagger конфігурація для FiatLux API.
     * Включає OpenAPI 3.0.0, базову інформацію про сервіс та автоматичне сканування JSDoc-коментарів у цьому файлі.
     */
    const swaggerOptions = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'FiatLux API',
          version: '1.0.0',
          description: 'API для моніторингу графіків відключень Черкасиобленерго',
        },
        components: {
          schemas: {
            HealthStatus: {
              type: 'object',
              properties: {
                status: { type: 'string', description: 'Статус сервісу' },
                uptime: { type: 'integer', description: 'Час роботи сервісу (секунди)' },
                telegramConnected: { type: 'boolean', description: 'Чи підключено Telegram' },
                lastMessageCheck: { type: 'string', description: 'Остання перевірка повідомлень' },
                lastParsedPublishedAt: { type: 'string', description: 'Дата останнього розпарсеного графіку' },
                schedulesCount: { type: 'integer', description: 'Кількість графіків' }
              }
            },
            Schedule: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Унікальний ідентифікатор графіку' },
                type: { type: 'string', description: 'Тип графіку (current, future, past)' },
                date: { type: 'string', description: 'Дата графіку (YYYY-MM-DD)' },
                queues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Назва черги' },
                      timeSlots: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            start: { type: 'string', description: 'Початок відключення (HH:mm)' },
                            end: { type: 'string', description: 'Кінець відключення (HH:mm)' }
                          }
                        }
                      }
                    }
                  }
                },
                rawText: { type: 'string', description: 'Оригінальний текст повідомлення' }
              }
            }
          }
        }
      },
      apis: [__filename],
    };

    /**
     * @swaggerDocs
     * Swagger документація генерується автоматично на основі JSDoc-коментарів.
     * Доступна за адресою /api-docs.
     */
    const swaggerDocs = swaggerJsdoc(swaggerOptions);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

    // Redirect /docs to /api-docs for convenience
    this.app.get('/docs', (_req, res) => res.redirect('/api-docs'));

    /**
     * @openapi
     * /api/health:
     *   get:
     *     summary: Отримати статус здоров'я сервісу
     *     description: Повертає інформацію про стан сервісу, підключення до Telegram та кількість графіків.
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Інформація про здоров'я сервісу
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/HealthStatus'
     */
    // Health check
    this.app.get('/api/health', async (req: Request, res: Response) => {
      await this.handleHealthCheck(req, res);
    });

    /**
     * @openapi
     * /api/schedule/current:
     *   get:
     *     summary: Отримати поточний графік відключень
     *     description: Повертає актуальний графік для сьогоднішнього дня.
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: Дані поточного графіку
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Schedule'
     */
    // Get current schedule
    this.app.get('/api/schedule/current', async (req: Request, res: Response) => {
      await this.handleGetCurrent(req, res);
    });

    /**
     * @openapi
     * /api/schedule/future:
     *   get:
     *     summary: Отримати майбутній графік відключень
     *     description: Повертає графік на наступний день.
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: Дані майбутнього графіку
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Schedule'
     */
    // Get future schedule
    this.app.get('/api/schedule/future', async (req: Request, res: Response) => {
      await this.handleGetFuture(req, res);
    });

    /**
     * @openapi
     * /api/schedule/all:
     *   get:
     *     summary: Отримати всі доступні графіки
     *     description: Повертає список усіх розпарсених графіків.
     *     tags: [Schedules]
     *     responses:
     *       200:
     *         description: Список всіх графіків
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Schedule'
     */
    // Get all schedules
    this.app.get('/api/schedule/all', async (req: Request, res: Response) => {
      await this.handleGetAll(req, res);
    });

    /**
     * @openapi
     * /api/schedule/history:
     *   get:
     *     summary: Історія розпарсених повідомлень (сьогодні і завтра)
     *     description: Повертає історію розпарсених повідомлень за обраний період.
     *     tags: [History]
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *         description: Кількість записів для повернення
     *     responses:
     *       200:
     *         description: Історія повідомлень
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Schedule'
     */
    // Get history (relevant only)
    this.app.get('/api/schedule/history', async (req: Request, res: Response) => {
      await this.handleGetHistory(req, res);
    });

    /**
     * @openapi
     * /api/schedule/messages:
     *   get:
     *     summary: Отримати всі розпарсені повідомлення (сирий історичний список)
     *     description: Повертає всі розпарсені повідомлення Telegram з історії.
     *     tags: [History]
     *     parameters:
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Кількість записів для повернення
     *     responses:
     *       200:
     *         description: Список розпарсених повідомлень
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 $ref: '#/components/schemas/Schedule'
     */
    // Get all messages
    this.app.get('/api/schedule/messages', async (req: Request, res: Response) => {
      await this.handleGetMessages(req, res);
    });

    /**
     * @openapi
     * /api/refresh:
     *   post:
     *     summary: Примусовий ручний оновлення/парсинг Telegram повідомлень
     *     description: Запускає ручний парсинг останніх повідомлень Telegram та оновлює графіки.
     *     tags: [System]
     *     responses:
     *       200:
     *         description: Результати оновлення
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 messagesChecked:
     *                   type: integer
     *                 schedulesParsed:
     *                   type: integer
     */
    // Refresh schedules
    this.app.post('/api/refresh', async (req: Request, res: Response) => {
      await this.handleRefresh(req, res);
    });

    /**
     * @openapi
     * /api/debug/dates:
     *   get:
     *     summary: Debug-ендпоінт для перевірки системної дати
     *     description: Повертає інформацію про системну дату, локальний час, сьогодні та завтра.
     *     tags: [Debug]
     *     responses:
     *       200:
     *         description: Інформація про дату та час
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 systemDate:
     *                   type: string
     *                 localTime:
     *                   type: string
     *                 todayDetected:
     *                   type: string
     *                 tomorrowDetected:
     *                   type: string
     */
    // Debug endpoint to check system date detection
    this.app.get('/api/debug/dates', (_req: Request, res: Response) => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `${tomorrow.getFullYear()}-${(tomorrow.getMonth() + 1).toString().padStart(2, '0')}-${tomorrow.getDate().toString().padStart(2, '0')}`;

      res.json({
        systemDate: new Date().toISOString(),
        localTime: today.toString(),
        todayDetected: todayStr,
        tomorrowDetected: tomorrowStr,
      });
    });

    /**
     * @openapi
     * /api/setup/status:
     *   get:
     *     summary: Отримати статус налаштування та конфігурації
     *     description: Повертає статус налаштування Telegram API та сесії.
     *     tags: [Setup]
     *     responses:
     *       200:
     *         description: Статус конфігурації
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 configured:
     *                   type: boolean
     *                 hasApiCredentials:
     *                   type: boolean
     *                 hasSession:
     *                   type: boolean
     *                 apiId:
     *                   type: string
     */
    // Setup endpoints
    this.app.get('/api/setup/status', async (req: Request, res: Response) => {
      await this.handleSetupStatus(req, res);
    });

    /**
     * @openapi
     * /api/setup/credentials:
     *   post:
     *     summary: Зберегти Telegram API credentials
     *     description: Зберігає API_ID та API_HASH для Telegram API.
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               apiId:
     *                 type: string
     *               apiHash:
     *                 type: string
     *     responses:
     *       200:
     *         description: Credentials збережено успішно
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     */
    this.app.post('/api/setup/credentials', async (req: Request, res: Response) => {
      await this.handleSaveCredentials(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/start:
     *   post:
     *     summary: Почати процес Telegram автентифікації
     *     description: Запускає автентифікацію Telegram за номером телефону.
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               phoneNumber:
     *                 type: string
     *     responses:
     *       200:
     *         description: Процес автентифікації запущено
     */
    this.app.post('/api/setup/auth/start', async (req: Request, res: Response) => {
      await this.handleAuthStart(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/code:
     *   post:
     *     summary: Ввести Telegram код підтвердження
     *     description: Надсилає код підтвердження для Telegram сесії.
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               sessionId:
     *                 type: string
     *               code:
     *                 type: string
     *     responses:
     *       200:
     *         description: Код підтвердження прийнято
     */
    this.app.post('/api/setup/auth/code', async (req: Request, res: Response) => {
      await this.handleAuthCode(req, res);
    });

    /**
     * @openapi
     * /api/setup/auth/password:
     *   post:
     *     summary: Ввести Telegram 2FA пароль
     *     description: Надсилає пароль для двофакторної автентифікації Telegram.
     *     tags: [Setup]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               sessionId:
     *                 type: string
     *               password:
     *                 type: string
     *     responses:
     *       200:
     *         description: Пароль прийнято
     */
    this.app.post('/api/setup/auth/password', async (req: Request, res: Response) => {
      await this.handleAuthPassword(req, res);
    });

    /**
     * @openapi
     * /api/setup/restart:
     *   post:
     *     summary: Перезапустити сервіс після завершення налаштування
     *     description: Перезапускає сервіс для застосування нових налаштувань Telegram.
     *     tags: [Setup]
     *     responses:
     *       200:
     *         description: Сервіс перезапускається
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 message:
     *                   type: string
     */
    // Перезапуск сервісу після завершення setup (Docker перезапустить контейнер)
    this.app.post('/api/setup/restart', (_req: Request, res: Response) => {
      logger.info('Restart requested after setup completion');
      res.json({
        success: true,
        data: { message: 'Service restarting...' },
        timestamp: new Date().toISOString(),
      });
      // Даємо час відправити відповідь, потім завершуємо процес
      setTimeout(() => {
        logger.info('Restarting service to apply new credentials...');
        process.exit(0);
      }, 2000);
    });


  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      const response: ApiResponse = {
        success: false,
        error: 'Endpoint not found',
        timestamp: new Date().toISOString(),
      };
      res.status(404).json(response);
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error('API Error:', err);

      const response: ApiResponse = {
        success: false,
        error: err.message || 'Internal server error',
        timestamp: new Date().toISOString(),
      };

      res.status(500).json(response);
    });
  }

  private async handleHealthCheck(_req: Request, res: Response): Promise<void> {
    try {
      const schedulesCount = await this.dataManager.getCount();

      const health: HealthStatus = {
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        telegramConnected: this.telegramMonitor.isConnected(),
        lastMessageCheck: this.lastMessageCheck,
        lastParsedPublishedAt: await this.getLastParsedDate(),
        schedulesCount,
      };

      const response: ApiResponse<HealthStatus> = {
        success: true,
        data: health,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetCurrent(_req: Request, res: Response): Promise<void> {
    try {
      const schedule = await this.dataManager.getCurrentSchedule();

      const response: ApiResponse = {
        success: true,
        data: schedule,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetFuture(_req: Request, res: Response): Promise<void> {
    try {
      const schedule = await this.dataManager.getFutureSchedule();

      const response: ApiResponse = {
        success: true,
        data: schedule,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetAll(_req: Request, res: Response): Promise<void> {
    try {
      const schedules = await this.dataManager.getAllSchedules();

      const response: ApiResponse = {
        success: true,
        data: schedules,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetHistory(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const history = await this.dataManager.getHistory(limit);

      const response: ApiResponse = {
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleGetMessages(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const history = await this.dataManager.getRawHistory(limit);

      const response: ApiResponse = {
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleRefresh(_req: Request, res: Response): Promise<void> {
    try {
      logger.info('Manual refresh requested');
      this.lastMessageCheck = new Date().toISOString();

      const messages = await this.telegramMonitor.getRecentMessages(50);
      const schedules = ScheduleParser.parseMessages(messages);

      for (const schedule of schedules) {
        await this.dataManager.saveSchedule(schedule);
      }

      const response: ApiResponse = {
        success: true,
        data: {
          messagesChecked: messages.length,
          schedulesParsed: schedules.length,
        },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Refresh error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleSetupStatus(_req: Request, res: Response): Promise<void> {
    try {
      const hasApiCredentials = this.envManager.hasApiCredentials();
      const hasSession = !!this.envManager.getVariable('SESSION_STRING');
      const isConfigured = this.envManager.hasRequiredCredentials();

      const response: ApiResponse = {
        success: true,
        data: {
          configured: isConfigured,
          hasApiCredentials,
          hasSession,
          apiId: hasApiCredentials ? this.envManager.getVariable('API_ID') : undefined,
        },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleSaveCredentials(req: Request, res: Response): Promise<void> {
    try {
      const { apiId, apiHash } = req.body;

      if (!apiId || !apiHash) {
        res.status(400).json({
          success: false,
          error: 'API_ID and API_HASH are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Validate API_ID is a number
      const apiIdNum = parseInt(apiId, 10);
      if (isNaN(apiIdNum)) {
        res.status(400).json({
          success: false,
          error: 'API_ID must be a number',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Save to .env
      this.envManager.updateVariables({
        API_ID: apiId,
        API_HASH: apiHash,
      });

      logger.info('Telegram API credentials saved');

      const response: ApiResponse = {
        success: true,
        data: { message: 'Credentials saved successfully' },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Save credentials error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthStart(req: Request, res: Response): Promise<void> {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        res.status(400).json({
          success: false,
          error: 'Phone number is required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const apiId = parseInt(this.envManager.getVariable('API_ID') || '', 10);
      const apiHash = this.envManager.getVariable('API_HASH') || '';

      if (!apiId || !apiHash) {
        res.status(400).json({
          success: false,
          error: 'API credentials not configured',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.startAuth(apiId, apiHash, phoneNumber);

      const response: ApiResponse = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth start error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthCode(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, code } = req.body;

      if (!sessionId || !code) {
        res.status(400).json({
          success: false,
          error: 'Session ID and code are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.submitCode(sessionId, code);

      if (result.success && result.sessionString) {
        // Save session string to .env
        this.envManager.updateVariables({
          SESSION_STRING: result.sessionString,
        });
        logger.info('Session string saved successfully');
      }

      const response: ApiResponse = {
        success: true,
        data: { ...result, restartRequired: !!(result.success && result.sessionString) },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth code error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleAuthPassword(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId, password } = req.body;

      if (!sessionId || !password) {
        res.status(400).json({
          success: false,
          error: 'Session ID and password are required',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      const result = await this.authManager.submitPassword(sessionId, password);

      if (result.success && result.sessionString) {
        // Save session string to .env
        this.envManager.updateVariables({
          SESSION_STRING: result.sessionString,
        });
        logger.info('Session string saved successfully (with 2FA)');
      }

      const response: ApiResponse = {
        success: true,
        data: { ...result, restartRequired: !!(result.success && result.sessionString) },
        timestamp: new Date().toISOString(),
      };

      res.json(response);
    } catch (error) {
      const err = error as Error;
      logger.error('Auth password error:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  updateLastMessageCheck(): void {
    this.lastMessageCheck = new Date().toISOString();
  }

  private async getLastParsedDate(): Promise<string | undefined> {
    try {
      const history = await this.dataManager.getHistory(1);
      return history.length > 0 ? history[0].publishedAt : undefined;
    } catch (error) {
      logger.error('Error getting last parsed date:', error);
      return undefined;
    }
  }

  listen(port: number, host: string): void {
    this.app.listen(port, host, () => {
      logger.info(`API server listening on http://${host}:${port}`);
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}
