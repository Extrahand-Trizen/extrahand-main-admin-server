import { TaskPostedEmailSettings } from '../models/TaskPostedEmailSettings';
import { TASK_POSTED_EMAIL_RECIPIENTS } from '../constants/taskAssignment';

export type TaskPostedEmailSettingsData = {
  recipients: string[];
  excludedPhones: string[];
};

function normalizePhone(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export async function getTaskPostedEmailSettings(): Promise<TaskPostedEmailSettingsData> {
  const settings = await TaskPostedEmailSettings.findOne({ key: 'task_posted_email' }).lean();
  return {
    recipients: settings
      ? (settings.recipients || []).map(normalizeEmail).filter(Boolean)
      : [...TASK_POSTED_EMAIL_RECIPIENTS],
    excludedPhones: (settings?.excludedPhones || []).map(normalizePhone).filter(Boolean),
  };
}

export async function updateTaskPostedEmailSettings(
  data: TaskPostedEmailSettingsData,
  updatedBy?: string,
): Promise<TaskPostedEmailSettingsData> {
  const recipients = Array.from(new Set(data.recipients.map(normalizeEmail).filter(Boolean)));
  const excludedPhones = Array.from(new Set(data.excludedPhones.map(normalizePhone).filter(Boolean)));
  const settings = await TaskPostedEmailSettings.findOneAndUpdate(
    { key: 'task_posted_email' },
    { $set: { recipients, excludedPhones, updatedBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return {
    recipients: settings?.recipients || recipients,
    excludedPhones: settings?.excludedPhones || excludedPhones,
  };
}

export function isPhoneExcluded(phone: string | undefined, excludedPhones: string[]): boolean {
  const normalized = normalizePhone(phone || '');
  if (!normalized) return false;
  const lastTen = normalized.slice(-10);
  return excludedPhones.some((excluded) => {
    const normalizedExcluded = normalizePhone(excluded);
    return normalizedExcluded === normalized || normalizedExcluded.slice(-10) === lastTen;
  });
}