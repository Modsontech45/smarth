import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import authRoutes from './routes/auth.routes';
import devicesRoutes from './routes/devices.routes';
import sensorsRoutes from './routes/sensors.routes';
import actuatorsRoutes from './routes/actuators.routes';
import alertsRoutes from './routes/alerts.routes';
import configRoutes       from './routes/config.routes';
import automationsRoutes  from './routes/automations.routes';
import adminRoutes        from './routes/admin.routes';
import esp32Routes        from './routes/esp32.routes';
import energyRoutes       from './routes/energy.routes';
import camerasRoutes      from './routes/cameras.routes';

const app = express();

app.use(cors());
app.use(express.json());

// ── Swagger ──────────────────────────────────────────────────
const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SmartHome API',
      version: '1.0.0',
      description: 'SmartHome IoT Backend REST API',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: process.env.NODE_ENV === 'production'
    ? ['./dist/routes/*.js']
    : ['./src/routes/*.ts'],
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Routes ───────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/sensors', sensorsRoutes);
app.use('/api/actuators', actuatorsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/config',      configRoutes);
app.use('/api/automations', automationsRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/esp32',       esp32Routes);
app.use('/api/energy',      energyRoutes);
app.use('/api/cameras',     camerasRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Server time (for frontend timezone display) ───────────────
app.get('/api/time', (_req, res) => {
  const now = new Date();
  res.json({
    iso:       now.toISOString(),
    timestamp: now.getTime(),
    hhmm:      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
});

// ── Global error handler ──────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Erreur interne du serveur' });
});

export default app;
