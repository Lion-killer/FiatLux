import { Api } from 'telegram/tl';
import { Schedule, QueueInfo, TimeSlot } from '../types';
import { logger } from '../utils/logger';

// ─── Helpers ────────────────────────────────────────────────────────────────

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  'січня': 1,  'січень': 1,
  'лютого': 2, 'лютий': 2,
  'березня': 3, 'березень': 3,
  'квітня': 4,  'квітень': 4,
  'травня': 5,  'травень': 5,
  'червня': 6,  'червень': 6,
  'липня': 7,   'липень': 7,
  'серпня': 8,  'серпень': 8,
  'вересня': 9, 'вересень': 9,
  'жовтня': 10, 'жовтень': 10,
  'листопада': 11, 'листопад': 11,
  'грудня': 12, 'грудень': 12,
};

// ─── Parser ─────────────────────────────────────────────────────────────────

/**
 * Parser for power outage schedule messages from Cherkasyoblenergo channel.
 */
export class ScheduleParser {
  private static readonly KEYWORDS = [
    'графік',
    'графік відключень',
    'черга',
    'група',
    'відключення',
    'вимкнення',
    'знеструмлення',
  ];

  // ── Public API ─────────────────────────────────────────────────────────────

  static isScheduleMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return this.KEYWORDS.some(kw => lower.includes(kw));
  }

  static determineScheduleType(_text: string, date: Date): 'current' | 'future' {
    const today       = startOfDay(new Date());
    const scheduleDay = startOfDay(date);
    return scheduleDay > today ? 'future' : 'current';
  }

  static isRelevantDate(date: Date): boolean {
    const today            = startOfDay(new Date());
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    const scheduleDay = startOfDay(date);
    return scheduleDay >= today && scheduleDay < dayAfterTomorrow;
  }

  static extractDate(text: string): string | null {
    const markerIdx = text.toLowerCase().indexOf('години відсутності електропостачання');
    const searchText = markerIdx >= 0 ? text.slice(0, markerIdx) : text;

    const date = this.findUkrainianDate(searchText, new Date());
    if (!date) logger.warn('extractDate: не вдалося визначити дату з тексту');
    return date;
  }

  static extractTimeSlotsFromLine(text: string): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const pattern = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g;

    for (const match of text.matchAll(pattern)) {
      const startH = parseInt(match[1], 10);
      const endH   = parseInt(match[3], 10);
      if (startH > 24 || endH > 24) continue;

      slots.push({
        start: `${match[1].padStart(2, '0')}:${match[2]}`,
        end:   `${match[3].padStart(2, '0')}:${match[4]}`,
      });
    }

    return slots;
  }

  static extractQueuesWithSubQueues(text: string): QueueInfo[] {
    const queuesMap = new Map<string, TimeSlot[]>();

    for (const match of text.matchAll(/(\d+)\.(\d+):\s*([^\n]+)/g)) {
      const key       = `${match[1]}.${match[2]}`;
      const timeSlots = this.extractTimeSlotsFromLine(match[3]);
      if (timeSlots.length > 0) queuesMap.set(key, timeSlots);
    }

    return Array.from(queuesMap, ([key, timeSlots]) => {
      const [main, sub] = key.split('.').map(Number);
      return {
        queueNumber: main + sub / 10,
        timeSlots,
        description: `Черга ${key}`,
      };
    }).sort((a, b) => a.queueNumber - b.queueNumber);
  }

  static parseMessage(message: Api.Message, strict = true): Schedule | null {
    const text = message.message;
    if (!text || !this.isScheduleMessage(text)) return null;

    try {
      const date = this.extractDate(text);
      if (!date) {
        logger.warn(`Could not extract date from message ID ${message.id}. Text starts with: "${text.substring(0, 50)}..."`);
        return null;
      }

      const queues = this.extractQueuesWithSubQueues(text);

      if (queues.length === 0) {
        logger.debug(`Skipping message ID ${message.id} - no queues found in text`);
        return null;
      }

      if (!queues.some(q => q.timeSlots?.length > 0)) {
        logger.debug(`Skipping message ID ${message.id} - no time slots found in any of the ${queues.length} queues`);
        return null;
      }

      // Треба — парсити як локальну дату:
      const [year, month, day] = date.split('-').map(Number);
      const scheduleDate = new Date(year, month - 1, day); // локальний час 
      if (strict && !this.isRelevantDate(scheduleDate)) {
        logger.debug(`Skipping schedule for ${date} - not today or tomorrow (strict mode)`);
        return null;
      }

      const type = this.determineScheduleType(text, scheduleDate);

      const schedule: Schedule = {
        id:          `${message.id}-${date}`,
        type,
        date,
        queues,
        rawText:     text,
        publishedAt: new Date(message.date * 1000).toISOString(),
        messageId:   message.id,
        channelId:   message.chatId?.toString() ?? '',
        archived:    false,
      };

      logger.info(`Parsed schedule: ${type} for ${date} with ${queues.length} queues`);
      return schedule;
    } catch (error) {
      logger.error('Error parsing message:', error);
      return null;
    }
  }

  static parseMessages(messages: Api.Message[], strict = true): Schedule[] {
    return messages.reduce<Schedule[]>((acc, msg) => {
      const schedule = this.parseMessage(msg, strict);
      if (schedule) acc.push(schedule);
      return acc;
    }, []);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Формує рядок дати. Повертає `null`, якщо день або місяць поза допустимим діапазоном.
   */
  private static buildDateString(
    day: string | number,
    monthNum: number,
    year: number,
  ): string | null {
    const d = typeof day === 'string' ? parseInt(day, 10) : day;
    if (d < 1 || d > 31 || monthNum < 1 || monthNum > 12) return null;
    return `${year}-${monthNum.toString().padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /**
   * Визначає рік з урахуванням переходу між роками.
   * Якщо зараз грудень, а місяць розкладу — січень, беремо наступний рік.
   * Якщо зараз січень, а місяць розкладу — грудень, беремо попередній рік.
   */
  private static resolveYear(month: number, ref: Date): number {
    const year     = ref.getFullYear();
    const refMonth = ref.getMonth() + 1;
    if (refMonth === 12 && month === 1)  return year + 1;
    if (refMonth === 1  && month === 12) return year - 1;
    return year;
  }

  /** Шукає першу українську дату виду "DD місяць" у тексті. */
  private static findUkrainianDate(text: string, ref: Date): string | null {
    const lower = text.toLowerCase();
    for (const [name, num] of Object.entries(MONTHS)) {
      const match = lower.match(new RegExp(`(\\d{1,2})\\s+${name}`));
      if (match) {
        return this.buildDateString(match[1], num, this.resolveYear(num, ref));
      }
    }
    return null;
  }
}