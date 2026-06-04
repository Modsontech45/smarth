import { Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { AuthenticatedRequest } from '../types';

export const verifyDeviceKeys = async (
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> => {
  const apiKey    = req.headers['x-api-key']    as string;
  const deviceKey = req.headers['x-device-key'] as string;

  if (!apiKey || !deviceKey) {
    res.status(401).json({ error: 'Les en-têtes x-api-key et x-device-key sont obligatoires' });
    return;
  }

  const userResult = await pool.query('SELECT id FROM users WHERE api_key = $1', [apiKey]);
  if ((userResult.rowCount ?? 0) === 0) {
    res.status(401).json({ error: 'api_key invalide' });
    return;
  }
  const userId = userResult.rows[0].id;

  const deviceResult = await pool.query(
    'SELECT id, owner_id, name, type, zone FROM devices WHERE device_key = $1',
    [deviceKey]
  );
  if ((deviceResult.rowCount ?? 0) === 0) {
    res.status(401).json({ error: 'device_key invalide' });
    return;
  }
  const device = deviceResult.rows[0];

  if (device.owner_id !== userId) {
    res.status(403).json({ error: 'Cet appareil n\'appartient pas à ce compte' });
    return;
  }

  req.device = device;
  req.userId = userId;
  next();
};
