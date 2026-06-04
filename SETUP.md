# SmartHome Secure — Guide de Configuration du Backend

> **Stack :** Node.js · TypeScript · Express · WebSocket (`ws`) · PostgreSQL · JWT · bcrypt  
> **Matériel :** ESP32 DevKit (firmware C++)  
> **Projet :** Système IoT de Maison Intelligente et Préventive basé sur ESP32

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Prérequis](#2-prérequis)
3. [Structure du projet](#3-structure-du-projet)
4. [Installation](#4-installation)
5. [Variables d'environnement](#5-variables-denvironnement)
6. [Configuration de la base de données (PostgreSQL)](#6-configuration-de-la-base-de-données-postgresql)
7. [Démarrage du serveur](#7-démarrage-du-serveur)
8. [Endpoints REST API](#8-endpoints-rest-api)
9. [Événements WebSocket](#9-événements-websocket)
10. [Intégration ESP32](#10-intégration-esp32)
11. [Stratégie d'authentification et de sécurité](#11-stratégie-dauthentification-et-de-sécurité)
12. [Système d'alertes](#12-système-dalertes)
13. [Règles d'automatisation](#13-règles-dautomatisation)
14. [Partage avec votre partenaire (ngrok)](#14-partage-avec-votre-partenaire-ngrok)
15. [Documentation API avec Postman](#15-documentation-api-avec-postman)
16. [Déploiement (VPS)](#16-déploiement-vps)

---

## 1. Vue d'ensemble de l'architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VPS (Cloud)                              │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│   │  Express     │    │  WebSocket   │    │  Alert Service  │  │
│   │  REST API    │    │  Server (ws) │    │  (Email/Push)   │  │
│   └──────┬───────┘    └──────┬───────┘    └────────┬────────┘  │
│          │                   │                     │           │
│          └───────────────────┴─────────────────────┘           │
│                              │                                  │
│                    ┌─────────▼─────────┐                        │
│                    │   PostgreSQL DB    │                        │
│                    │  (smarthome_db)   │                        │
│                    └───────────────────┘                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │  Internet
          ┌────────────────────┼─────────────────────┐
          │                    │                     │
   ┌──────▼──────┐     ┌───────▼──────┐    ┌────────▼───────┐
   │  ESP32      │     │  React Web   │    │ React Native   │
   │  DevKit     │     │  Dashboard   │    │ Mobile App     │
   │  (Home)     │     │  (HTTPS/REST)│    │(WS + REST)     │
   └─────────────┘     └──────────────┘    └────────────────┘
         │
   ┌─────▼─────────────────────────────────┐
   │ Sensors              Actuators         │
   │ - DHT22 (Temp/Humidity)               │
   │ - MQ-2/MQ-135 (Gas/Smoke)            │
   │ - PIR (Motion)                        │
   │ - Water Leak Sensor                   │
   │ - LDR (Light)                         │
   │ - Relay (Lights, Fan, Power)         │
   │ - Buzzer (Alarm)                      │
   └───────────────────────────────────────┘
```

**Protocoles de communication :**
- ESP32 ↔ Serveur : **WebSocket** (données capteurs en temps réel + commandes)
- Dashboard/Mobile ↔ Serveur : **API REST** (HTTPS) + **WebSocket** (mises à jour en temps réel)
- ESP32 → Capteurs/Actionneurs : **GPIO / I2C**

---

## 2. Prérequis

| Outil | Version | Rôle |
|-------|---------|------|
| Node.js | >= 18.x | Environnement d'exécution |
| npm | >= 9.x | Gestionnaire de paquets |
| TypeScript | >= 5.x | Langage |
| PostgreSQL | >= 14.x | Base de données |
| ngrok | dernière | Accès distant pendant le développement |
| Postman | dernière | Tests et documentation API |

Installer Node.js depuis [nodejs.org](https://nodejs.org) et PostgreSQL depuis [postgresql.org](https://www.postgresql.org/download/).

---

## 3. Structure du projet

```
smarthome-backend/
├── src/
│   ├── index.ts                  # Point d'entrée
│   ├── app.ts                    # Configuration Express
│   ├── websocket/
│   │   ├── wsServer.ts           # Serveur WebSocket
│   │   ├── esp32Handler.ts       # Gestionnaire des messages ESP32
│   │   └── dashboardHandler.ts   # Gestionnaire des messages Dashboard
│   ├── routes/
│   │   ├── auth.routes.ts        # POST /api/auth/login, /register
│   │   ├── devices.routes.ts     # CRUD /api/devices
│   │   ├── sensors.routes.ts     # GET /api/sensors
│   │   ├── actuators.routes.ts   # GET/POST /api/actuators
│   │   ├── alerts.routes.ts      # GET/PATCH /api/alerts
│   │   ├── automations.routes.ts # CRUD /api/automations
│   │   └── config.routes.ts      # GET/PUT /api/config
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── devices.controller.ts
│   │   ├── sensors.controller.ts
│   │   ├── actuators.controller.ts
│   │   ├── alerts.controller.ts
│   │   ├── automations.controller.ts
│   │   └── config.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts    # Vérification JWT (dashboard)
│   │   ├── device.middleware.ts  # Vérification api_key + device_token (ESP32)
│   │   └── role.middleware.ts    # Garde de rôle (ADMIN, USER, GUEST)
│   ├── services/
│   │   ├── alert.service.ts      # Vérification des seuils + notifications
│   │   ├── email.service.ts      # Notifications email (nodemailer)
│   │   └── automation.service.ts # Exécution des règles d'automatisation
│   ├── models/
│   │   ├── User.ts
│   │   ├── Device.ts
│   │   ├── SensorReading.ts
│   │   ├── ActuatorState.ts
│   │   ├── Alert.ts
│   │   ├── Automation.ts
│   │   └── SystemConfig.ts
│   ├── db/
│   │   ├── pool.ts               # Pool de connexion PostgreSQL
│   │   └── migrations/
│   │       └── 001_init.sql      # Schéma initial de la base de données
│   └── types/
│       ├── websocket.types.ts    # Définitions des types de messages WS
│       └── index.ts
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── SETUP.md
```

---

## 4. Installation

```bash
# 1. Créer le dossier du projet et y accéder
mkdir smarthome-backend
cd smarthome-backend

# 2. Initialiser le projet
npm init -y

# 3. Installer TypeScript et les outils associés
npm install -D typescript ts-node nodemon @types/node

# 4. Initialiser la configuration TypeScript
npx tsc --init

# 5. Installer les dépendances principales
npm install express ws jsonwebtoken bcrypt pg dotenv cors
npm install nodemailer

# 6. Installer les définitions de types
npm install -D @types/express @types/ws @types/jsonwebtoken @types/bcrypt @types/pg @types/cors @types/nodemailer

# 7. Installer swagger pour la documentation API
npm install swagger-ui-express swagger-jsdoc
npm install -D @types/swagger-ui-express @types/swagger-jsdoc
```

### tsconfig.json (paramètres recommandés)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Scripts package.json

```json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "migrate": "psql -U postgres -d smarthome_db -f src/db/migrations/001_init.sql"
  }
}
```

---

## 5. Variables d'environnement

Créer un fichier `.env` à la racine du projet :

```env
# Serveur
PORT=3000
NODE_ENV=development

# Base de données
DB_HOST=localhost
DB_PORT=5432
DB_NAME=smarthome_db
DB_USER=postgres
DB_PASSWORD=votre_mot_de_passe_db

# JWT
JWT_SECRET=votre_cle_secrete_jwt_a_changer_en_production
JWT_EXPIRES_IN=24h

# Longueur des clés secrètes générées (crypto.randomBytes)
# api_key et device_token = 32 bytes → 64 caractères hexadécimaux
API_KEY_BYTES=32
DEVICE_TOKEN_BYTES=32

# Notifications email (nodemailer)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=votre_email@gmail.com
EMAIL_PASS=votre_mot_de_passe_application
EMAIL_FROM=SmartHome Alerte <votre_email@gmail.com>

# Seuils d'alerte (peuvent aussi être stockés en DB via SystemConfig)
TEMP_MAX=35
GAS_PPM_MAX=400
```

---

## 6. Configuration de la base de données (PostgreSQL)

### Créer la base de données

```sql
-- À exécuter dans psql ou pgAdmin
CREATE DATABASE smarthome_db;
```

### Fichier de migration : `src/db/migrations/001_init.sql`

```sql
-- ============================================================
-- Table des utilisateurs
-- api_key : clé générée automatiquement à la création du compte.
-- L'ESP32 l'utilise pour s'identifier comme appartenant à ce compte.
-- ============================================================
CREATE TYPE user_role AS ENUM ('ADMIN', 'USER', 'GUEST');

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  role        user_role DEFAULT 'USER',
  api_key     VARCHAR(64) UNIQUE NOT NULL,  -- généré à l'inscription (crypto.randomBytes)
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Table des appareils (capteurs ET actionneurs)
-- C'est la table maître : tout capteur ou actionneur est
-- d'abord enregistré ici avant d'envoyer ou recevoir des données.
--
-- Sécurité à double niveau :
--   1. owner_id  → l'appareil appartient à un compte (vérifié via api_key du compte)
--   2. device_key → clé aléatoire unique générée automatiquement à l'ajout de
--                   l'appareil sur le site (crypto.randomBytes).
--      L'ESP32 doit envoyer les DEUX pour que la requête soit acceptée.
-- ============================================================
CREATE TYPE device_type   AS ENUM ('INPUT', 'OUTPUT');
CREATE TYPE device_status AS ENUM ('ONLINE', 'OFFLINE');

CREATE TABLE devices (
  id          SERIAL PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,         -- ex : "Capteur température salon"
  device_key  VARCHAR(64) UNIQUE NOT NULL,   -- clé aléatoire générée à la création (crypto.randomBytes)
  type        device_type NOT NULL,          -- INPUT = capteur | OUTPUT = actionneur
  status      device_status DEFAULT 'OFFLINE',
  zone        VARCHAR(50) DEFAULT 'main',    -- salon, cuisine, chambre, exterieur...
  description TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Note : les appareils sont ajoutés depuis le site (pas hardcodés ici).
-- Le backend génère device_key = crypto.randomBytes(32).toString('hex')
-- lors du POST /api/devices et le retourne UNE SEULE FOIS au frontend.

-- ============================================================
-- Table des relevés de capteurs
-- Liée à la table devices via device_id
-- ============================================================
CREATE TABLE sensor_readings (
  id           SERIAL PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  temperature  FLOAT,
  humidity     FLOAT,
  gas_ppm      FLOAT,
  air_quality  FLOAT,
  motion       BOOLEAN DEFAULT FALSE,
  light_lux    FLOAT,
  water_leak   BOOLEAN DEFAULT FALSE,
  recorded_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Table des états des actionneurs
-- Liée à la table devices via device_id
-- ============================================================
CREATE TABLE actuator_states (
  id           SERIAL PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state        BOOLEAN DEFAULT FALSE,
  triggered_by VARCHAR(20) DEFAULT 'manual', -- 'manual' | 'auto'
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- Insérer les états par défaut pour chaque actionneur
INSERT INTO actuator_states (device_id, state)
  SELECT id, false FROM devices WHERE type = 'OUTPUT';

-- ============================================================
-- Table des alertes
-- ============================================================
CREATE TYPE alert_type     AS ENUM ('FIRE', 'GAS_LEAK', 'INTRUSION', 'WATER_LEAK', 'HIGH_TEMP', 'POWER_CUT');
CREATE TYPE alert_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE alerts (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  type        alert_type NOT NULL,
  zone        VARCHAR(50),
  severity    alert_severity DEFAULT 'WARNING',
  message     TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  resolved_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Table des automatisations
-- Chaque règle définit : un déclencheur (capteur ou heure)
-- et une action (commande sur un actionneur).
-- ============================================================
CREATE TYPE trigger_type     AS ENUM ('SENSOR_THRESHOLD', 'TIME_BASED', 'DEVICE_STATUS');
CREATE TYPE trigger_condition AS ENUM ('GT', 'LT', 'EQ', 'GTE', 'LTE');

CREATE TABLE automations (
  id                 SERIAL PRIMARY KEY,
  owner_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               VARCHAR(100) NOT NULL,        -- ex : "Allumer lumières la nuit"
  description        TEXT,

  -- Déclencheur
  trigger_type       trigger_type NOT NULL,         -- SENSOR_THRESHOLD | TIME_BASED | DEVICE_STATUS
  trigger_device_id  INTEGER REFERENCES devices(id) ON DELETE CASCADE, -- appareil capteur source
  trigger_condition  trigger_condition,             -- GT | LT | EQ | GTE | LTE
  trigger_value      FLOAT,                        -- seuil ex : 35 (temp > 35°C)
  trigger_time       TIME,                         -- heure si type = TIME_BASED ex : '21:00'

  -- Action
  action_device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE, -- actionneur cible
  action_state       BOOLEAN NOT NULL,             -- true = allumer | false = éteindre

  enabled            BOOLEAN DEFAULT TRUE,
  last_triggered_at  TIMESTAMP,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW()
);

-- Exemples d'automatisations par défaut (à adapter selon owner_id réel)
-- Allumer lumière extérieure si luminosité < 100 lux
-- Allumer ventilateur si température > 35°C
-- Déclencher alarme si mouvement détecté
-- Éteindre toutes les lumières à 23h00

-- ============================================================
-- Table de configuration système (stockage clé-valeur)
-- ============================================================
CREATE TABLE system_config (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(100) UNIQUE NOT NULL,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Insérer la configuration par défaut
INSERT INTO system_config (key, value, description) VALUES
  ('temp_max',        '35',   'Seuil maximum de température (°C)'),
  ('gas_ppm_max',     '400',  'Concentration maximale de gaz (ppm)'),
  ('light_threshold', '100',  'Niveau de luminosité pour allumer les lumières automatiquement (lux)'),
  ('sensor_interval', '300',  'Intervalle de lecture des capteurs ESP32 (secondes)'),
  ('auto_mode',       'true', 'Activer les règles d automatisation intelligente');
```

### Exécuter la migration

```bash
npm run migrate
```

---

## 7. Démarrage du serveur

```bash
# Développement (avec rechargement automatique)
npm run dev

# Production
npm run build && npm start
```

Le serveur démarre sur : `http://localhost:3000`  
Documentation Swagger : `http://localhost:3000/api-docs`

---

## 8. Endpoints REST API

### Authentification

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| POST | `/api/auth/register` | Créer un compte → retourne `api_key` | Non |
| POST | `/api/auth/login` | Connexion → retourne un token JWT | Non |
| GET | `/api/auth/me` | Obtenir le profil + `api_key` | Oui (JWT) |
| POST | `/api/auth/regenerate-api-key` | Régénérer l'`api_key` du compte | Oui (JWT) |

**Corps d'inscription :**
```json
{
  "name": "Alice",
  "email": "alice@smarthome.com",
  "password": "motdepasse"
}
```

**Réponse d'inscription (201) — l'`api_key` est générée aléatoirement et retournée UNE SEULE FOIS :**
```json
{
  "message": "Compte créé avec succès",
  "api_key": "a3f8c2e1d4b7...",
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@smarthome.com",
    "role": "USER"
  }
}
```

> ⚠️ **Important :** copier et stocker l'`api_key` immédiatement. Elle ne sera plus affichée en clair après cette réponse. Elle sera flashée dans le firmware de l'ESP32.

**Corps de la requête de connexion :**
```json
{
  "email": "alice@smarthome.com",
  "password": "motdepasse"
}
```

**Réponse de connexion (200) :**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "name": "Alice",
    "email": "alice@smarthome.com",
    "role": "USER"
  }
}
```

**Réponse d'erreur (401) :**
```json
{ "error": "Identifiants incorrects" }
```

---

### Appareils (Devices)

> Table maître — tout capteur ou actionneur doit être enregistré ici avant utilisation.

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/devices` | Lister tous les appareils | Oui |
| GET | `/api/devices?type=INPUT` | Filtrer par type (INPUT/OUTPUT) | Oui |
| GET | `/api/devices?status=ONLINE` | Filtrer par statut | Oui |
| GET | `/api/devices/:id` | Obtenir un appareil par son ID | Oui |
| POST | `/api/devices` | Ajouter un nouvel appareil | ADMIN |
| PUT | `/api/devices/:id` | Mettre à jour un appareil | ADMIN |
| DELETE | `/api/devices/:id` | Supprimer un appareil | ADMIN |
| PATCH | `/api/devices/:id/status` | Mettre à jour le statut (ONLINE/OFFLINE) | ADMIN |

**Objet appareil (réponse GET — `device_key` masqué après création) :**
```json
{
  "id": 1,
  "name": "Capteur Temp/Humidité Salon",
  "type": "INPUT",
  "status": "ONLINE",
  "zone": "salon",
  "description": "Capteur DHT22 — température et humidité",
  "created_at": "2025-06-03T08:00:00Z",
  "updated_at": "2025-06-03T10:30:00Z"
}
```

**Types d'appareils :**
- `INPUT` — Capteur (DHT22, MQ-2, PIR, LDR, fuite d'eau)
- `OUTPUT` — Actionneur (relais lumières, ventilateur, alarme)

**Statuts :**
- `ONLINE` — Appareil connecté et actif
- `OFFLINE` — Appareil déconnecté ou hors service

**Corps pour ajouter un appareil (POST) — pas de `device_key` dans le corps, il est généré automatiquement :**
```json
{
  "name": "Capteur Gaz Chambre",
  "type": "INPUT",
  "zone": "chambre",
  "description": "Capteur MQ-2 supplémentaire dans la chambre"
}
```

**Réponse à l'ajout (201) — `device_key` retourné UNE SEULE FOIS :**
```json
{
  "message": "Appareil ajouté avec succès",
  "device": {
    "id": 6,
    "name": "Capteur Gaz Chambre",
    "device_key": "f7e3a1c9b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
    "type": "INPUT",
    "zone": "chambre"
  }
}
```

> ⚠️ **Important :** copier le `device_key` immédiatement et le flasher dans le firmware ESP32 avec l'`api_key` du compte. Il ne sera plus affiché après cette réponse.

---

### Relevés des capteurs

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/sensors/latest` | Obtenir le dernier relevé de capteurs | Oui |
| GET | `/api/sensors/history` | Obtenir l'historique des capteurs (paginé) | Oui |
| GET | `/api/sensors/history?from=2025-01-01&to=2025-01-31` | Historique filtré par date | Oui |
| GET | `/api/sensors/device/:device_id` | Historique d'un capteur spécifique | Oui |

**Réponse du dernier relevé :**
```json
{
  "id": 42,
  "device_id": 1,
  "device_key": "DHT22_SALON",
  "device_name": "Capteur Temp/Humidité Salon",
  "zone": "salon",
  "temperature": 28.5,
  "humidity": 65.2,
  "gas_ppm": 120.0,
  "air_quality": 95.0,
  "motion": false,
  "light_lux": 85.0,
  "water_leak": false,
  "recorded_at": "2025-06-03T10:30:00Z"
}
```

---

### Actionneurs

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/actuators` | Obtenir l'état de tous les actionneurs | Oui |
| POST | `/api/actuators/command` | Envoyer une commande à un actionneur | USER |

**Corps de la commande :**
```json
{
  "actuator": "LIGHT_SALON",
  "state": true
}
```

**Actionneurs disponibles :**
- `LIGHT_SALON` — Lumière du salon
- `LIGHT_BEDROOM` — Lumière de la chambre
- `LIGHT_KITCHEN` — Lumière de la cuisine
- `LIGHT_EXTERIOR` — Lumière extérieure
- `FAN` — Ventilateur
- `ALARM` — Buzzer d'alarme

---

### Alertes

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/alerts` | Obtenir toutes les alertes (plus récentes en premier) | Oui |
| GET | `/api/alerts?resolved=false` | Obtenir uniquement les alertes non résolues | Oui |
| PATCH | `/api/alerts/:id/resolve` | Marquer une alerte comme résolue | USER |

**Objet alerte :**
```json
{
  "id": 5,
  "type": "GAS_LEAK",
  "zone": "kitchen",
  "severity": "CRITICAL",
  "message": "Gas concentration exceeded 400 ppm",
  "resolved": false,
  "created_at": "2025-06-03T10:30:00Z"
}
```

**Types d'alerte :** `FIRE` | `GAS_LEAK` | `INTRUSION` | `WATER_LEAK` | `HIGH_TEMP` | `POWER_CUT`  
**Niveaux de sévérité :** `INFO` | `WARNING` | `CRITICAL`

---

### Automatisations

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/automations` | Lister toutes les automatisations | Oui |
| GET | `/api/automations/:id` | Obtenir une automatisation | Oui |
| POST | `/api/automations` | Créer une règle d'automatisation | USER |
| PUT | `/api/automations/:id` | Modifier une règle | USER |
| DELETE | `/api/automations/:id` | Supprimer une règle | USER |
| PATCH | `/api/automations/:id/toggle` | Activer / désactiver une règle | USER |

**Objet automatisation :**
```json
{
  "id": 1,
  "name": "Allumer lumières si nuit",
  "description": "Active la lumière extérieure quand la luminosité baisse",
  "trigger_type": "SENSOR_THRESHOLD",
  "trigger_device_id": 5,
  "trigger_condition": "LT",
  "trigger_value": 100,
  "trigger_time": null,
  "action_device_id": 9,
  "action_state": true,
  "enabled": true,
  "last_triggered_at": "2025-06-03T21:05:00Z"
}
```

**Types de déclencheurs (`trigger_type`) :**
| Type | Description | Champs utilisés |
|------|-------------|-----------------|
| `SENSOR_THRESHOLD` | Seuil capteur dépassé | `trigger_device_id`, `trigger_condition`, `trigger_value` |
| `TIME_BASED` | Heure fixe chaque jour | `trigger_time` |
| `DEVICE_STATUS` | Appareil passe ONLINE/OFFLINE | `trigger_device_id`, `trigger_condition` (`EQ`) |

**Conditions (`trigger_condition`) :** `GT` > · `LT` < · `EQ` = · `GTE` >= · `LTE` <=

**Exemples de règles courantes :**
```json
// Allumer ventilateur si température > 35°C
{ "name": "Ventilation automatique", "trigger_type": "SENSOR_THRESHOLD",
  "trigger_device_id": 1, "trigger_condition": "GT", "trigger_value": 35,
  "action_device_id": 10, "action_state": true }

// Éteindre toutes les lumières à 23h00
{ "name": "Extinction nocturne", "trigger_type": "TIME_BASED",
  "trigger_time": "23:00",
  "action_device_id": 6, "action_state": false }

// Allumer lumière extérieure si luminosité < 100 lux
{ "name": "Éclairage automatique", "trigger_type": "SENSOR_THRESHOLD",
  "trigger_device_id": 5, "trigger_condition": "LT", "trigger_value": 100,
  "action_device_id": 9, "action_state": true }
```

---

### Configuration système

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/config` | Obtenir toutes les valeurs de configuration | Oui |
| PUT | `/api/config/:key` | Mettre à jour une valeur de configuration | ADMIN |

---

## 9. Événements WebSocket

Le serveur WebSocket fonctionne sur le **même port** que HTTP (connexion upgradée).  
URL WebSocket : `ws://localhost:3000`

Tous les messages sont des **chaînes JSON** avec un champ `type`.

---

### ESP32 → Serveur

#### Authentification (double vérification)

L'ESP32 doit envoyer **les deux clés** à chaque connexion WebSocket :
- `api_key` → prouve qu'il appartient à un compte utilisateur valide
- `device_key` → clé aléatoire générée à l'ajout de l'appareil sur le site

```json
{
  "type": "ESP32_AUTH",
  "api_key": "a3f8c2e1d4b7...",
  "device_key": "f7e3a1c9b2d4e5f6a7b8c9d0e1f2a3b4..."
}
```

**Logique de vérification côté serveur :**
1. Chercher l'utilisateur par `api_key` → 401 si introuvable
2. Chercher le device par `device_token` → 401 si introuvable
3. Vérifier que `device.owner_id === user.id` → 403 si le device n'appartient pas à ce compte
4. Si tout est valide → `AUTH_SUCCESS` + marquer le device `ONLINE`

**Réponse en cas de succès :**
```json
{ "type": "AUTH_SUCCESS", "device_id": 1, "device_key": "DHT22_SALON" }
```

**Réponses en cas d'échec :**
```json
{ "type": "AUTH_FAILED", "message": "api_key invalide" }
{ "type": "AUTH_FAILED", "message": "device_token invalide" }
{ "type": "AUTH_FAILED", "message": "Cet appareil n appartient pas à ce compte" }
```

#### Envoi des données capteurs
> Après `AUTH_SUCCESS`, le serveur associe automatiquement les données à l'appareil via la session WebSocket. Pas besoin de renvoyer `device_key` dans chaque message.
```json
{
  "type": "SENSOR_DATA",
  "reading": {
    "temperature": 28.5,
    "humidity": 65.2,
    "gas_ppm": 120.0,
    "motion": false,
    "light_lux": 85.0,
    "water_leak": false
  }
}
```

**Réponse du serveur :**
```json
{ "type": "DATA_ACK", "rows": 1 }
```

#### Envoi d'une alerte (seuil critique dépassé)
> Envoyé seulement après une authentification réussie. Le serveur connaît déjà le `device_id` de la session.
```json
{
  "type": "ALERT",
  "alert_type": "GAS_LEAK",
  "severity": "CRITICAL",
  "value": 520
}
```

**Réponse du serveur :**
```json
{ "type": "ALERT_ACK", "alertId": 12 }
```

---

### Dashboard → Serveur

#### Authentification
```json
{
  "type": "DASHBOARD_AUTH",
  "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Envoi d'une commande d'actionneur
```json
{
  "type": "COMMAND",
  "device_key": "LIGHT_SALON",
  "state": true
}
```

---

### Serveur → ESP32

#### Exécuter une commande d'actionneur
```json
{
  "type": "COMMAND",
  "device_key": "LIGHT_SALON",
  "state": true
}
```

**Erreur si l'ESP32 est hors ligne :**
```json
{ "type": "ERROR", "code": "ESP32_OFFLINE" }
```

---

### Serveur → Dashboard

#### Mise à jour des capteurs en temps réel
```json
{
  "type": "SENSOR_UPDATE",
  "data": {
    "temperature": 28.5,
    "humidity": 65.2,
    "gas_ppm": 120.0,
    "motion": false,
    "light_lux": 85.0,
    "water_leak": false,
    "recorded_at": "2025-06-03T10:30:00Z"
  }
}
```

#### Mise à jour de l'état d'un actionneur
```json
{
  "type": "ACTUATOR_UPDATE",
  "actuator": "LIGHT_SALON",
  "state": true,
  "timestamp": "2025-06-03T10:31:00Z"
}
```

#### Nouvelle notification d'alerte
```json
{
  "type": "NEW_ALERT",
  "alert_type": "GAS_LEAK",
  "zone": "kitchen",
  "severity": "CRITICAL",
  "message": "Gas concentration exceeded threshold",
  "alertId": 12,
  "timestamp": "2025-06-03T10:32:00Z"
}
```

#### Statut de connexion de l'ESP32
```json
{ "type": "ESP32_STATUS", "connected": true }
```

#### Mise à jour du statut d'un appareil
```json
{
  "type": "DEVICE_STATUS_UPDATE",
  "device_id": 1,
  "device_key": "DHT22_SALON",
  "status": "OFFLINE",
  "timestamp": "2025-06-03T10:35:00Z"
}
```

---

## 10. Intégration ESP32

### Machine à états de l'ESP32

L'ESP32 passe par les états suivants :

```
[DEMARRAGE]
    ↓
[CONNEXION_WIFI]  ←──── nouvelle tentative en cas d'échec
    ↓ succès
[AUTH_SERVEUR]  ←─────── nouvelle tentative si token invalide
    ↓ AUTH_SUCCESS
[VEILLE]  ←───────────────────────────────┐
    ↓ timer (toutes les 5 min)             │
[LECTURE_CAPTEURS]                         │
    ↓                                      │
[ENVOI_DONNEES]  ──── DATA_ACK ───────────┘
    │
    └── timeout/erreur → [CONNEXION_WIFI]

[VEILLE]  ──── seuil dépassé ────→ [ALERTE_CRITIQUE]
[VEILLE]  ──── COMMAND reçue ───→ [EXECUTION_COMMANDE] → [VEILLE]
```

### Sketch firmware Arduino/ESP32 (référence)

```cpp
// Exemple de client WebSocket ESP32 (framework Arduino)
// Installer : bibliothèque arduinoWebSockets de Markus Sattler

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* wsHost      = "votre-url-ngrok-ou-serveur.com"; // sans ws://
const int   wsPort      = 80;   // 443 pour wss://

// Ces deux valeurs sont générées sur le site et flashées dans le firmware
const char* accountApiKey = "a3f8c2e1d4b7...";              // api_key du compte utilisateur
const char* deviceKey     = "f7e3a1c9b2d4e5f6a7b8c9d0...";  // device_key généré à l'ajout

WebSocketsClient webSocket;
bool authenticated = false;

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_TEXT) {
    StaticJsonDocument<512> doc;
    deserializeJson(doc, payload);
    const char* msgType = doc["type"];

    if (strcmp(msgType, "AUTH_SUCCESS") == 0) {
      authenticated = true;
    } else if (strcmp(msgType, "COMMAND") == 0) {
      const char* actuator = doc["actuator"];
      bool state = doc["state"];
      // Gérer la commande actionneur : basculer la broche GPIO
    } else if (strcmp(msgType, "DATA_ACK") == 0) {
      // Données enregistrées avec succès
    } else if (strcmp(msgType, "ALERT_ACK") == 0) {
      // Alerte prise en charge
    }
  }
}

void sendAuth() {
  StaticJsonDocument<256> doc;
  doc["type"]       = "ESP32_AUTH";
  doc["api_key"]    = accountApiKey;  // clé du compte utilisateur
  doc["device_key"] = deviceKey;      // clé aléatoire de cet appareil
  String msg;
  serializeJson(doc, msg);
  webSocket.sendTXT(msg);
}

// Après AUTH_SUCCESS, le serveur connaît déjà l'appareil via la session WS.
// Le device_key de la session est utilisé automatiquement côté serveur.
void sendSensorData(float temp, float hum) {
  StaticJsonDocument<256> doc;
  doc["type"] = "SENSOR_DATA";
  JsonObject reading = doc.createNestedObject("reading");
  reading["temperature"] = temp;
  reading["humidity"]    = hum;
  String msg;
  serializeJson(doc, msg);
  webSocket.sendTXT(msg);
}

void setup() {
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  webSocket.begin(wsHost, wsPort, "/");
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  if (webSocket.isConnected() && !authenticated) {
    sendAuth();
    delay(1000);
  }
}
```

### Correspondance capteurs/actionneurs et broches GPIO (référence)

| Capteur/Actionneur | Broche GPIO | Protocole | Remarques |
|--------------------|-------------|-----------|-----------|
| DHT22 (Temp/Humidité) | GPIO 4 | 1-Wire | Utiliser la bibliothèque `DHT` |
| MQ-2 (Gaz/Fumée) | GPIO 34 | Analogique | Broche ADC |
| PIR (Mouvement) | GPIO 14 | Numérique | HIGH = mouvement détecté |
| Capteur de fuite d'eau | GPIO 35 | Analogique/Numérique | |
| LDR (Luminosité) | GPIO 32 | Analogique | |
| Relais - Lumière Salon | GPIO 26 | Numérique | LOW = ON (relais actif bas) |
| Relais - Lumière Chambre | GPIO 27 | Numérique | |
| Relais - Lumière Cuisine | GPIO 25 | Numérique | |
| Relais - Lumière Extérieure | GPIO 33 | Numérique | |
| Relais - Ventilateur | GPIO 19 | Numérique | |
| Buzzer (Alarme) | GPIO 18 | Numérique | |

---

## 11. Stratégie d'authentification et de sécurité

Le système utilise **trois mécanismes d'authentification distincts** selon l'acteur :

| Acteur | Mécanisme | Transmis via |
|--------|-----------|--------------|
| Dashboard / Frontend | JWT (JSON Web Token) | Header `Authorization: Bearer <token>` |
| ESP32 (WebSocket) | `api_key` + `device_token` | Champ JSON dans le message `ESP32_AUTH` |
| ESP32 (REST optionnel) | `api_key` + `device_key` | Headers `X-API-Key` + `X-Device-Key` |

---

### Flux 1 — Inscription utilisateur (génération de l'api_key)

```
Frontend                      API REST                  PostgreSQL
    │                             │                          │
    │── POST /api/auth/register ─▶│                          │
    │   { name, email, password } │  bcrypt.hash(password)   │
    │                             │  crypto.randomBytes(32)  │
    │                             │── INSERT user ──────────▶│
    │                             │   (api_key généré)       │
    │◀── 201 { api_key, user } ───│                          │
    │                             │                          │
    │  ⚠️ Stocker api_key         │                          │
    │  → flasher dans l'ESP32     │                          │
```

---

### Flux 2 — Connexion utilisateur (JWT pour le dashboard)

```
Frontend                      API REST                  PostgreSQL
    │                             │                          │
    │── POST /api/auth/login ────▶│                          │
    │   { email, password }       │── SELECT user par ──────▶│
    │                             │   email                  │
    │                             │◀── ligne user ───────────│
    │                             │  bcrypt.compare()        │
    │                             │  jwt.sign()              │
    │◀── 200 { token, user } ─────│                          │
    │                             │                          │
    │  Stocker token en           │                          │
    │  localStorage               │                          │
    │── GET /api/sensors ────────▶│                          │
    │   Authorization: Bearer...  │  middleware verifyJWT    │
```

---

### Flux 3 — Ajout d'un appareil (génération du device_key)

```
Frontend (Admin)              API REST                  PostgreSQL
    │                             │                          │
    │── POST /api/devices ───────▶│                          │
    │   Authorization: Bearer...  │  verifyJWT               │
    │   { name, type, zone }      │  crypto.randomBytes(32)  │
    │                             │── INSERT device ────────▶│
    │                             │   (device_key généré)    │
    │◀── 201 { device_key, ... } ─│                          │
    │                             │                          │
    │  ⚠️ Stocker device_key      │                          │
    │  → flasher dans l'ESP32     │                          │
    │  avec l'api_key du compte   │                          │
```

---

### Flux 4 — Connexion de l'ESP32 (double vérification)

```
ESP32                        Serveur WS                PostgreSQL
    │                             │                          │
    │── WS connect ──────────────▶│                          │
    │                             │                          │
    │── ESP32_AUTH ──────────────▶│                          │
    │   { api_key,                │── SELECT user WHERE ────▶│
    │     device_key }            │   api_key = ?            │
    │                             │◀── user row ─────────────│
    │                             │── SELECT device WHERE ──▶│
    │                             │   device_key = ?         │
    │                             │◀── device row ───────────│
    │                             │                          │
    │                             │  Vérifier :              │
    │                             │  device.owner_id         │
    │                             │  === user.id ?           │
    │                             │                          │
    │                             │── UPDATE device ────────▶│
    │                             │   status = 'ONLINE'      │
    │◀── AUTH_SUCCESS ────────────│                          │
    │    { device_id, name,       │                          │
    │      type, zone }           │                          │
```

**Erreurs possibles :**
```json
{ "type": "AUTH_FAILED", "message": "api_key invalide" }
{ "type": "AUTH_FAILED", "message": "device_key invalide" }
{ "type": "AUTH_FAILED", "message": "Cet appareil n'appartient pas à ce compte" }
```

---

### Middlewares TypeScript

**Middleware JWT — pour le dashboard (src/middleware/auth.middleware.ts) :**
```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const verifyJWT = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};
```

**Middleware double clé — pour les routes ESP32 REST (src/middleware/device.middleware.ts) :**
```typescript
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

export const verifyDeviceKeys = async (
  req: Request, res: Response, next: NextFunction
) => {
  const apiKey    = req.headers['x-api-key']    as string;
  const deviceKey = req.headers['x-device-key'] as string;

  if (!apiKey || !deviceKey) {
    return res.status(401).json({ error: 'x-api-key et x-device-key requis' });
  }

  // 1. Vérifier l'api_key → trouver le compte utilisateur
  const userResult = await pool.query(
    'SELECT id FROM users WHERE api_key = $1', [apiKey]
  );
  if (userResult.rowCount === 0) {
    return res.status(401).json({ error: 'api_key invalide' });
  }
  const userId = userResult.rows[0].id;

  // 2. Vérifier le device_key → trouver l'appareil
  const deviceResult = await pool.query(
    'SELECT id, owner_id, name, type, zone FROM devices WHERE device_key = $1',
    [deviceKey]
  );
  if (deviceResult.rowCount === 0) {
    return res.status(401).json({ error: 'device_key invalide' });
  }
  const device = deviceResult.rows[0];

  // 3. Vérifier que l'appareil appartient bien à ce compte
  if (device.owner_id !== userId) {
    return res.status(403).json({ error: 'Cet appareil n\'appartient pas à ce compte' });
  }

  // 4. Attacher au contexte de la requête
  (req as any).device = device;
  (req as any).userId = userId;
  next();
};
```

**Utilisation dans les routes :**
```typescript
// Route accessible uniquement par un appareil ESP32 authentifié
router.post('/api/esp32/sensor-data', verifyDeviceKeys, sensorController.store);
router.post('/api/esp32/alert',       verifyDeviceKeys, alertController.create);
```

---

## 12. Système d'alertes

### Logique de vérification des seuils

Lorsque le serveur reçoit `SENSOR_DATA` de l'ESP32, il exécute `checkThresholds()` :

```typescript
// src/services/alert.service.ts (logique de référence)

interface SensorReading {
  temperature: number;
  gas_ppm: number;
  motion: boolean;
  water_leak: boolean;
}

async function checkThresholds(reading: SensorReading): Promise<void> {
  const config = await getSystemConfig();

  if (reading.gas_ppm > Number(config.gas_ppm_max)) {
    await createAlert({ type: 'GAS_LEAK', zone: 'main', severity: 'CRITICAL' });
    await sendEmailNotification('GAS_LEAK');
    broadcastToAll({ type: 'NEW_ALERT', alert_type: 'GAS_LEAK', severity: 'CRITICAL' });
  }

  if (reading.temperature > Number(config.temp_max)) {
    await createAlert({ type: 'HIGH_TEMP', zone: 'main', severity: 'WARNING' });
    broadcastToAll({ type: 'NEW_ALERT', alert_type: 'HIGH_TEMP', severity: 'WARNING' });
    // Déclenchement automatique du ventilateur
    sendCommandToESP32({ type: 'COMMAND', actuator: 'FAN', state: true });
  }

  if (reading.motion) {
    await createAlert({ type: 'INTRUSION', zone: 'entrance', severity: 'WARNING' });
    broadcastToAll({ type: 'NEW_ALERT', alert_type: 'INTRUSION', severity: 'WARNING' });
  }

  if (reading.water_leak) {
    await createAlert({ type: 'WATER_LEAK', zone: 'kitchen', severity: 'CRITICAL' });
    await sendEmailNotification('WATER_LEAK');
    broadcastToAll({ type: 'NEW_ALERT', alert_type: 'WATER_LEAK', severity: 'CRITICAL' });
  }
}
```

---

## 13. Règles d'automatisation

Les règles d'automatisation intelligente s'exécutent automatiquement selon les données des capteurs :

| Déclencheur | Condition | Action |
|-------------|-----------|--------|
| Baisse de luminosité | `light_lux < 100` (nuit) | Allumer les lumières extérieure et salon |
| Température élevée | `temperature > 35°C` | Allumer le ventilateur |
| Gaz détecté | `gas_ppm > 400` | Allumer l'alarme, envoyer une alerte, couper le relais |
| Mouvement détecté (mode absent) | `motion == true` | Déclencher l'alarme, envoyer une alerte |
| Inactivité | Aucun mouvement pendant 30 min | Éteindre toutes les lumières |
| Fuite d'eau | `water_leak == true` | Envoyer une alerte critique, couper le relais d'eau (si disponible) |

Ces règles sont configurables via la table `system_config` et l'endpoint `/api/config`.

---

## 14. Partage avec votre partenaire (ngrok)

Votre partenaire étant sur un réseau différent, utilisez **ngrok** pour exposer votre serveur local publiquement.

### Étape 1 — Installer ngrok

Télécharger depuis [ngrok.com](https://ngrok.com/download) ou :
```bash
npm install -g ngrok
```

### Étape 2 — Démarrer le serveur et ngrok

```bash
# Terminal 1 — Démarrer le backend
npm run dev

# Terminal 2 — Exposer publiquement
ngrok http 3000
```

### Étape 3 — Partager les URLs

ngrok vous fournit deux URLs :
```
HTTP:  http://a1b2c3d4.ngrok-free.app
HTTPS: https://a1b2c3d4.ngrok-free.app
```

Envoyez ces URLs à votre partenaire :

| Ce que c'est | URL |
|--------------|-----|
| API REST | `https://a1b2c3d4.ngrok-free.app/api/...` |
| Documentation API | `https://a1b2c3d4.ngrok-free.app/api-docs` |
| WebSocket | `wss://a1b2c3d4.ngrok-free.app` |

> **Remarque :** L'URL change à chaque redémarrage de ngrok sur le plan gratuit. Mettez à jour la variable `base_url` dans Postman et informez votre partenaire à chaque fois.

---

## 15. Documentation API avec Postman

### Configurer la variable d'environnement Postman

Créer un environnement dans Postman avec :

| Variable | Valeur |
|----------|--------|
| `base_url` | `https://a1b2c3d4.ngrok-free.app` |
| `jwt_token` | *(à remplir après la connexion)* |

Utiliser `{{base_url}}/api/auth/login` dans toutes les URLs des requêtes.

### Structure de la collection

```
SmartHome API
├── Authentification
│   ├── POST Connexion
│   ├── POST Inscription
│   └── GET Mon profil
├── Capteurs
│   ├── GET Dernier relevé
│   └── GET Historique
├── Actionneurs
│   ├── GET Tous les états
│   └── POST Envoyer une commande
├── Alertes
│   ├── GET Toutes les alertes
│   └── PATCH Résoudre une alerte
└── Configuration
    ├── GET Toute la configuration
    └── PUT Mettre à jour la configuration
```

### Partager la collection

1. **Via Git** — Exporter la collection en JSON → committer dans le dépôt → votre partenaire l'importe
2. **Via lien Postman** — Clic droit sur la collection → Share → Get public link

---

## 16. Déploiement (VPS)

Lorsque vous êtes prêts à déployer de façon permanente :

### Option A : Railway (la plus simple)

1. Pousser votre code sur GitHub
2. Aller sur [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Ajouter le plugin PostgreSQL dans Railway
4. Renseigner toutes les variables d'environnement du `.env` dans le tableau de bord Railway
5. Votre API est en ligne à : `https://smarthome-api.up.railway.app`

### Option B : DigitalOcean / AWS VPS

```bash
# Sur le VPS
git clone votre-repo
cd smarthome-backend
npm install
npm run build

# Utiliser PM2 pour maintenir le serveur en marche
npm install -g pm2
pm2 start dist/index.js --name smarthome-api
pm2 save
pm2 startup

# Utiliser nginx comme reverse proxy
# Pointer le domaine vers le port 3000
```

---

## Liste de démarrage rapide

- [ ] Installer Node.js 18+, PostgreSQL 14+
- [ ] Cloner/créer le dossier du projet
- [ ] Exécuter `npm install`
- [ ] Créer le fichier `.env` à partir de `.env.example`
- [ ] Créer la base de données PostgreSQL `smarthome_db`
- [ ] Exécuter `npm run migrate`
- [ ] Exécuter `npm run dev`
- [ ] Ouvrir `http://localhost:3000/api-docs`
- [ ] Lancer `ngrok http 3000` et partager l'URL avec votre partenaire
- [ ] Importer la collection Postman et définir `base_url`
- [ ] Flasher l'ESP32 avec le firmware pointant vers votre URL ngrok

---

*SmartHome Secure — PPE 2025*
