import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import logger from '../config/logger';
import { AppBrandingSettings } from '../models/AppBrandingSettings';
import { minioService } from '../services/MinioService';

const SETTINGS_KEY = 'customer_app';
const DEFAULT_ICON_ID = 'extrahand-default';
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

async function uploadImage(
  req: Request,
  res: Response,
  field: 'logoUrl' | 'launcherIconUrl',
  keyPrefix: string,
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'An image file is required' });
      return;
    }

    const extension = IMAGE_EXTENSIONS[req.file.mimetype];
    if (!extension) {
      res.status(400).json({ success: false, error: 'Only JPG, PNG or WebP images are allowed' });
      return;
    }

    const key = `${keyPrefix}/${randomUUID()}.${extension}`;
    const imageUrl = await minioService.uploadPublicFile(key, req.file.buffer, req.file.mimetype);
    const settings = await AppBrandingSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      { $set: { [field]: imageUrl, updatedBy: req.admin?.userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: AppBrandingSettingsController.toResponse(settings) });
  } catch (error) {
    logger.error(`Upload app ${field} error`, { error });
    res.status(500).json({ success: false, error: `Failed to upload app ${field}` });
  }
}

async function resetImage(
  req: Request,
  res: Response,
  field: 'logoUrl' | 'launcherIconUrl',
): Promise<void> {
  try {
    const settings = await AppBrandingSettings.findOneAndUpdate(
      { key: SETTINGS_KEY },
      {
        $set: {
          [field]: null,
          updatedBy: req.admin?.userId,
          ...(field === 'launcherIconUrl' ? { activeIconId: DEFAULT_ICON_ID } : {}),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ success: true, data: AppBrandingSettingsController.toResponse(settings) });
  } catch (error) {
    logger.error(`Reset app ${field} error`, { error });
    res.status(500).json({ success: false, error: `Failed to reset app ${field}` });
  }
}

export class AppBrandingSettingsController {
  static toResponse(settings: {
    logoUrl?: string | null;
    launcherIconUrl?: string | null;
    activeIconId?: string;
    launcherIcons?: Array<{ iconId: string; name: string; imageUrl: string }>;
  }) {
    const launcherIcons = [...(settings.launcherIcons ?? [])];
    if (
      settings.launcherIconUrl &&
      !launcherIcons.some((icon) => icon.iconId === 'legacy-launcher-icon')
    ) {
      launcherIcons.push({
        iconId: 'legacy-launcher-icon',
        name: 'Previously uploaded launcher icon',
        imageUrl: settings.launcherIconUrl,
      });
    }
    const activeIconId =
      settings.activeIconId ??
      (settings.launcherIconUrl ? 'legacy-launcher-icon' : DEFAULT_ICON_ID);
    return {
      logoUrl: settings.logoUrl ?? null,
      activeIconId,
      activeIconUrl: launcherIcons.find((icon) => icon.iconId === activeIconId)?.imageUrl ?? null,
      launcherIcons,
      launcherIconUrl: settings.launcherIconUrl ?? null,
    };
  }

  static async get(_req: Request, res: Response): Promise<void> {
    try {
      const settings = await AppBrandingSettings.findOne({ key: SETTINGS_KEY }).lean();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: AppBrandingSettingsController.toResponse(settings ?? {}) });
    } catch (error) {
      logger.error('Get app branding settings error', { error });
      res.status(500).json({ success: false, error: 'Failed to load app branding settings' });
    }
  }

  static uploadLogo(req: Request, res: Response): Promise<void> {
    return uploadImage(req, res, 'logoUrl', 'app-branding');
  }

  static resetLogo(req: Request, res: Response): Promise<void> {
    return resetImage(req, res, 'logoUrl');
  }

  static uploadLauncherIcon(req: Request, res: Response): Promise<void> {
    return uploadImage(req, res, 'launcherIconUrl', 'app-branding/launcher-icons');
  }

  static resetLauncherIcon(req: Request, res: Response): Promise<void> {
    return resetImage(req, res, 'launcherIconUrl');
  }

  static async addLauncherIcon(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'An image file is required' });
        return;
      }

      const extension = IMAGE_EXTENSIONS[req.file.mimetype];
      if (!extension) {
        res.status(400).json({ success: false, error: 'Only JPG, PNG or WebP images are allowed' });
        return;
      }

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 60) {
        res.status(400).json({
          success: false,
          error: 'Icon name is required and must be 60 characters or fewer',
        });
        return;
      }

      const iconId = `eh-${randomUUID()}`;
      const key = `app-branding/launcher-icons/${iconId}.${extension}`;
      const imageUrl = await minioService.uploadPublicFile(key, req.file.buffer, req.file.mimetype);
      const settings = await AppBrandingSettings.findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: { activeIconId: DEFAULT_ICON_ID },
          $push: {
            launcherIcons: {
              iconId,
              name,
              imageUrl,
              createdBy: req.admin?.userId,
              createdAt: new Date(),
            },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      ).lean();

      res.status(201).json({
        success: true,
        data: AppBrandingSettingsController.toResponse(settings ?? {}),
      });
    } catch (error) {
      logger.error('Add launcher icon error', { error });
      res.status(500).json({ success: false, error: 'Failed to add launcher icon' });
    }
  }

  static async activateLauncherIcon(req: Request, res: Response): Promise<void> {
    try {
      const iconId = typeof req.body?.iconId === 'string' ? req.body.iconId : '';
      if (!iconId) {
        res.status(400).json({ success: false, error: 'A launcher icon ID is required' });
        return;
      }

      const filter =
        iconId === DEFAULT_ICON_ID
          ? { key: SETTINGS_KEY }
          : iconId === 'legacy-launcher-icon'
            ? { key: SETTINGS_KEY, launcherIconUrl: { $ne: null } }
            : { key: SETTINGS_KEY, 'launcherIcons.iconId': iconId };
      const settings = await AppBrandingSettings.findOneAndUpdate(
        filter,
        { $set: { activeIconId: iconId, updatedBy: req.admin?.userId } },
        { new: true, upsert: iconId === DEFAULT_ICON_ID, setDefaultsOnInsert: true },
      ).lean();
      if (!settings) {
        res.status(404).json({ success: false, error: 'Launcher icon was not found' });
        return;
      }

      res.json({
        success: true,
        data: AppBrandingSettingsController.toResponse(settings),
      });
    } catch (error) {
      logger.error('Activate launcher icon error', { error });
      res.status(500).json({ success: false, error: 'Failed to activate launcher icon' });
    }
  }

  static async deleteLauncherIcon(req: Request, res: Response): Promise<void> {
    try {
      const { iconId } = req.params;
      if (!iconId || iconId === DEFAULT_ICON_ID || iconId === 'legacy-launcher-icon') {
        res.status(400).json({ success: false, error: 'A deletable uploaded launcher icon ID is required' });
        return;
      }

      const existing = await AppBrandingSettings.findOne(
        { key: SETTINGS_KEY, 'launcherIcons.iconId': iconId },
        { launcherIcons: 1 },
      ).lean();
      const icon = existing?.launcherIcons?.find((item) => item.iconId === iconId);
      if (!icon) {
        res.status(404).json({ success: false, error: 'Launcher icon was not found' });
        return;
      }

      const settings = await AppBrandingSettings.findOneAndUpdate(
        {
          key: SETTINGS_KEY,
          activeIconId: { $ne: iconId },
          'launcherIcons.iconId': iconId,
        },
        {
          $pull: { launcherIcons: { iconId } },
          $set: { updatedBy: req.admin?.userId },
        },
        { new: true },
      ).lean();
      if (!settings) {
        res.status(409).json({
          success: false,
          error: 'Select a different active icon before deleting this one',
        });
        return;
      }

      try {
        await minioService.deletePublicLauncherIcon(iconId, icon.imageUrl);
      } catch (error) {
        logger.error('Launcher icon was removed from the catalog but storage cleanup failed', {
          iconId,
          error,
        });
        res.status(500).json({
          success: false,
          error: 'Launcher icon was removed, but its stored image could not be deleted',
        });
        return;
      }

      res.json({
        success: true,
        data: AppBrandingSettingsController.toResponse(settings),
      });
    } catch (error) {
      logger.error('Delete launcher icon error', { error });
      res.status(500).json({ success: false, error: 'Failed to delete launcher icon' });
    }
  }
}
