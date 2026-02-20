/**
 * Type definitions for FiatLux
 */

import type { Api } from 'telegram/tl';

/** Telegram channel monitor contract (real implementation or placeholder) */
export interface ITelegramMonitor {
  isConnected(): boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getRecentMessages(limit?: number): Promise<Api.Message[]>;
  subscribeToNewMessages(handler: (message: Api.Message) => void): void;
}

export interface Schedule {
  id: string;
  type: 'current' | 'future';
  date: string;
  dateEnd?: string;
  queues: QueueInfo[];
  rawText: string;
  publishedAt: string;
  messageId: number;
  channelId: string;
  archived: boolean;
}

export interface QueueInfo {
  queueNumber: number;
  timeSlots: TimeSlot[];
  description?: string;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface ScheduleData {
  schedules: Schedule[];
  lastUpdated: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  uptime: number;
  telegramConnected: boolean;
  lastMessageCheck?: string;
  lastParsedPublishedAt?: string;
  schedulesCount: number;
}
