import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram/tl';
import type { ITelegramMonitor } from '../types';
import config from '../config';
import { logger } from '../utils/logger';

export class TelegramChannelMonitor implements ITelegramMonitor {
  private static readonly GET_MESSAGES_TIMEOUT_MS = 30_000;
  private static readonly CONSECUTIVE_FAILURES_BEFORE_RECREATE = 3;

  private client: TelegramClient;
  private connected: boolean = false;
  private session: StringSession;
  private messageHandler?: (message: Api.Message) => void;
  private lastFetchAt?: string;
  private lastFetchSuccessAt?: string;
  private lastFetchError?: string;
  private consecutiveFailures: number = 0;
  private recreatingClient: boolean = false;

  constructor() {
    this.session = new StringSession(config.telegram.sessionString);
    this.client = this.createClient();
  }

  private createClient(): TelegramClient {
    return new TelegramClient(
      this.session,
      config.telegram.apiId,
      config.telegram.apiHash,
      {
        connectionRetries: 10,
        retryDelay: 2000,
        autoReconnect: true,
        timeout: 30,
      }
    );
  }

  async connect(): Promise<void> {
    try {
      logger.info('Connecting to Telegram...');

      await this.client.connect();

      if (!await this.client.isUserAuthorized()) {
        logger.warn('Telegram client is connected but NOT authorized.');
        this.connected = false;
        throw new Error('NOT_AUTHORIZED');
      }

      this.connected = true;
      this.consecutiveFailures = 0;
      logger.info('Successfully connected to Telegram');

      // Save session string for future use
      const sessionString = this.client.session.save() as unknown as string;
      if (sessionString && !config.telegram.sessionString) {
        logger.info('');
        logger.info('='.repeat(80));
        logger.info('✅ ВАЖЛИВО! Авторизація успішна!');
        logger.info('');
        logger.info('Щоб не вводити номер телефону та код при кожному запуску,');
        logger.info('додайте цей рядок у ваш .env файл:');
        logger.info('');
        logger.info(`SESSION_STRING=${sessionString}`);
        logger.info('');
        logger.info('Після збереження Session String авторизація буде автоматичною.');
        logger.info('='.repeat(80));
        logger.info('');
      }
    } catch (error) {
      logger.error('Failed to connect to Telegram:', error);
      throw error;
    }
  }

  async getRecentMessages(limit: number = 50): Promise<Api.Message[]> {
    if (!this.connected) {
      throw new Error('Telegram client is not connected');
    }

    try {
      this.lastFetchAt = new Date().toISOString();
      logger.info(`Fetching ${limit} recent messages from ${config.telegram.channelUsername}...`);

      const messages = await this.withTimeout(
        this.client.getMessages(config.telegram.channelUsername, {
          limit,
        }),
        TelegramChannelMonitor.GET_MESSAGES_TIMEOUT_MS,
        `Telegram getMessages timeout after ${TelegramChannelMonitor.GET_MESSAGES_TIMEOUT_MS}ms`
      );

      logger.info(`Retrieved ${messages.length} messages`);
      this.lastFetchSuccessAt = new Date().toISOString();
      this.lastFetchError = undefined;
      this.consecutiveFailures = 0;
      return messages.filter((msg: any): msg is Api.Message => msg instanceof Api.Message);
    } catch (error) {
      this.lastFetchError = error instanceof Error ? error.message : String(error);
      this.consecutiveFailures++;
      logger.error(`Failed to fetch messages (failure #${this.consecutiveFailures}):`, error);

      // Після кількох послідовних невдач — пересоздаємо клієнт повністю
      if (this.consecutiveFailures >= TelegramChannelMonitor.CONSECUTIVE_FAILURES_BEFORE_RECREATE) {
        await this.recreateClient();
      }

      throw error;
    }
  }

  /**
   * Повністю пересоздає GramJS клієнт — скидає мертве TCP-з'єднання.
   * Викликається тільки після кількох послідовних невдач.
   */
  private async recreateClient(): Promise<void> {
    if (this.recreatingClient) {
      logger.warn('Client recreation already in progress, skipping');
      return;
    }

    this.recreatingClient = true;

    try {
      logger.warn(`Recreating Telegram client after ${this.consecutiveFailures} consecutive failures...`);

      // Тихо відключаємо старий клієнт
      try {
        await this.client.disconnect();
      } catch {
        // ігноруємо помилки disconnect
      }

      // Зберігаємо сесію з поточного клієнта
      try {
        const savedSession = this.client.session.save() as unknown as string;
        if (savedSession) {
          this.session = new StringSession(savedSession);
        }
      } catch {
        // якщо не вдалося зберегти — використовуємо початкову сесію
        this.session = new StringSession(config.telegram.sessionString);
      }

      // Створюємо новий клієнт
      this.client = this.createClient();

      // Підключаємося
      await this.client.connect();
      this.connected = await this.client.isUserAuthorized();
      this.consecutiveFailures = 0;

      if (this.connected) {
        logger.info('Telegram client recreated and reconnected successfully');
        // Переприв'язуємо event handler якщо був
        if (this.messageHandler) {
          this.resubscribeToMessages();
        }
      } else {
        logger.warn('Telegram client recreated but not authorized');
      }
    } catch (reconnectError) {
      logger.error('Failed to recreate Telegram client:', reconnectError);
      this.connected = false;
    } finally {
      this.recreatingClient = false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(errorMessage));
        }, timeoutMs);
      });

      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  subscribeToNewMessages(handler: (message: Api.Message) => void): void {
    if (!this.connected) {
      throw new Error('Telegram client is not connected');
    }

    this.messageHandler = handler;
    this.resubscribeToMessages();
  }

  private resubscribeToMessages(): void {
    if (!this.messageHandler) return;

    const handler = this.messageHandler;

    // Resolve entity спочатку для надійної фільтрації
    this.client.getInputEntity(config.telegram.channelUsername)
      .then(() => {
        this.client.addEventHandler(
          async (event: NewMessageEvent) => {
            const message = event.message;

            if (message instanceof Api.Message) {
              const preview = message.message ? message.message.substring(0, 100).replace(/\n/g, ' ') : '(no text)';
              logger.info(`New message received from event handler: ID ${message.id}. Text preview: "${preview}..."`);

              handler(message);
            }
          },
          new NewMessage({ chats: [config.telegram.channelUsername] })
        );
        logger.info(`Subscribed to new messages from ${config.telegram.channelUsername} (resolved entity)`);
      })
      .catch((err) => {
        // Fallback — підписка без фільтра по чату, фільтруємо вручну
        logger.warn(`Could not resolve channel entity, subscribing without chat filter: ${err.message}`);
        this.client.addEventHandler(
          async (event: NewMessageEvent) => {
            const message = event.message;

            if (message instanceof Api.Message) {
              const preview = message.message ? message.message.substring(0, 100).replace(/\n/g, ' ') : '(no text)';
              logger.info(`New message received: ID ${message.id} from chat ${message.chatId}. Text preview: "${preview}..."`);

              handler(message);
            }
          },
          new NewMessage({})
        );
        logger.info('Subscribed to all new messages (fallback mode)');
      });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
      logger.info('Disconnected from Telegram');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getHealth(): { lastFetchAt?: string; lastFetchSuccessAt?: string; lastFetchError?: string } {
    return {
      lastFetchAt: this.lastFetchAt,
      lastFetchSuccessAt: this.lastFetchSuccessAt,
      lastFetchError: this.lastFetchError,
    };
  }

  getClient(): TelegramClient {
    return this.client;
  }
}
