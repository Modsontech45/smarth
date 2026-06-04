import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import authRoutes from './routes/auth.routes';
import devicesRoutes from './routes/devices.routes';
import sensorsRoutes from './routes/sensors.routes';
import actuatorsRoutes from './routes/actuators.routes';
import alertsRoutes from './routes/alerts.routes';
import configRoutes from './routes/config.routes';

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
app.use('/api/config', configRoutes);

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
