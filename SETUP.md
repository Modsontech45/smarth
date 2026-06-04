# SmartHome Secure — Guide de Configuration du Backend

> **Stack :** Node.js · TypeScript · Express · WebSocket (`ws`) · PostgreSQL (Neon) · JWT · bcrypt · Google OAuth  
> **Matériel :** ESP32 DevKit (firmware C++)  
> **Projet :** Système IoT de Maison Intelligente et Préventive basé sur ESP32  
> **Backend live :** https://smarth-rlir.onrender.com

---

## Table des matières

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Prérequis](#2-prérequis)
3. [Structure du projet](#3-structure-du-projet)
4. [Installation](#4-installation)
5. [Variables d'environnement](#5-variables-denvironnement)
6. [Configuration de la base de données (Neon PostgreSQL)](#6-configuration-de-la-base-de-données-neon-postgresql)
7. [Démarrage du serveur](#7-démarrage-du-serveur)
8. [Système de rôles](#8-système-de-rôles)
9. [Endpoints REST API](#9-endpoints-rest-api)
10. [Statistiques et Analytiques](#10-statistiques-et-analytiques)
11. [Événements WebSocket](#11-événements-websocket)
12. [Intégration ESP32](#12-intégration-esp32)
13. [Stratégie d'authentification et de sécurité](#13-stratégie-dauthentification-et-de-sécurité)
14. [Système d'alertes](#14-système-dalertes)
15. [Règles d'automatisation](#15-règles-dautomatisation)
16. [Partage avec votre partenaire (ngrok)](#16-partage-avec-votre-partenaire-ngrok)
17. [Documentation API avec Postman](#17-documentation-api-avec-postman)
18. [Déploiement (Render / VPS)](#18-déploiement-render--vps)

---

## 1. Vue d'ensemble de l'architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Render / VPS (Cloud)                         │
│                                                                 │
│   ┌──────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│   │  Express     │    │  WebSocket   │    │  Email Service  │  │
│   │  REST API    │    │  Server (ws) │    │  (nodemailer)   │  │
│   └──────┬───────┘    └──────┬───────┘    └────────┬────────┘  │
│          │                   │                     │           │
│          └───────────────────┴─────────────────────┘           │
│                              │                                  │
│                    ┌─────────▼─────────┐                        │
│                    │   Neon PostgreSQL  │                        │
│                    │   (smarthome_db)  │                        │
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
| Neon PostgreSQL | cloud | Base de données (pas d'installation locale requise) |
| ngrok | dernière | Accès distant pendant le développement |
| Postman | dernière | Tests et documentation API |

---

## 3. Structure du projet

```
smarthome-backend/
├── src/
│   ├── index.ts                        # Point d'entrée
│   ├── app.ts                          # Configuration Express + Swagger
│   ├── websocket/
│   │   ├── wsServer.ts                 # Serveur WebSocket
│   │   ├── esp32Handler.ts             # Gestionnaire des messages ESP32
│   │   └── dashboardHandler.ts         # Gestionnaire des messages Dashboard
│   ├── routes/
│   │   ├── auth.routes.ts              # Toutes les routes auth + invitations
│   │   ├── devices.routes.ts           # CRUD /api/devices
│   │   ├── sensors.routes.ts           # GET /api/sensors + stats
│   │   ├── actuators.routes.ts         # GET/POST /api/actuators + stats
│   │   ├── alerts.routes.ts            # GET/PATCH /api/alerts
│   │   ├── automations.routes.ts       # CRUD /api/automations
│   │   └── config.routes.ts            # GET/PUT /api/config
│   ├── controllers/
│   │   ├── auth.controller.ts          # register, login, verify, forgot, reset, google, me
│   │   ├── invite.controller.ts        # invite, acceptInvite, getInvitations, cancel
│   │   ├── devices.controller.ts
│   │   ├── sensors.controller.ts       # latest, history, byDevice
│   │   ├── sensors.stats.controller.ts # min/max/moy par période
│   │   ├── actuators.controller.ts     # getActuators, sendCommand (+ log historique)
│   │   ├── actuators.stats.controller.ts # durée ON/OFF par période
│   │   ├── alerts.controller.ts
│   │   ├── automations.controller.ts
│   │   └── config.controller.ts
│   ├── middleware/
│   │   ├── auth.middleware.ts          # Vérification JWT
│   │   ├── device.middleware.ts        # Vérification api_key + device_key (ESP32)
│   │   └── role.middleware.ts          # Garde de rôle (ADMIN, USER, GUEST)
│   ├── services/
│   │   ├── alert.service.ts            # Vérification des seuils + notifications
│   │   ├── email.service.ts            # Emails : vérification, reset, invitation
│   │   └── automation.service.ts       # Exécution des règles d'automatisation
│   ├── db/
│   │   ├── pool.ts                     # Pool de connexion Neon PostgreSQL
│   │   └── migrations/
│   │       ├── 001_init.sql            # Schéma initial
│   │       ├── 002_invitations.sql     # Table invitations
│   │       └── 003_analytics.sql       # Table actuator_state_history + index
│   └── types/
│       ├── websocket.types.ts
│       └── index.ts
├── scripts/
│   ├── migrate.ts                      # Exécuter 001_init.sql
│   ├── migrate2.ts                     # Exécuter 002_invitations.sql
│   └── migrate3.ts                     # Exécuter 003_analytics.sql
├── postman/
│   └── SmartHome-Auth.postman_collection.json
├── Procfile                            # Build + start pour Render
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── SETUP.md
```

---

## 4. Installation

```bash
# 1. Cloner le projet
git clone https://github.com/Modsontech45/smarth.git
cd smarth

# 2. Installer toutes les dépendances
npm install
```

### Dépendances principales

```bash
npm install express ws jsonwebtoken bcrypt pg dotenv cors nodemailer google-auth-library swagger-ui-express swagger-jsdoc
npm install -D typescript ts-node nodemon @types/node @types/express @types/ws @types/jsonwebtoken @types/bcrypt @types/pg @types/cors @types/nodemailer @types/swagger-ui-express @types/swagger-jsdoc
```

### tsconfig.json

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
    "dev":   "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
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

# Base de données (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require&channel_binding=require

# JWT
JWT_SECRET=votre_cle_secrete_jwt_a_changer_en_production
JWT_EXPIRES_IN=24h

# Longueur des clés secrètes générées (crypto.randomBytes)
API_KEY_BYTES=32
DEVICE_TOKEN_BYTES=32

# Email (nodemailer — Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre_email@gmail.com
SMTP_PASS=votre_mot_de_passe_application
SMTP_FROM=noreply@votredomaine.com

# Resend (alternatif à SMTP)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx

# URL frontend (utilisée dans les liens des emails)
CLIENT_URL=http://localhost:5173

# URL backend live (Render)
BACKEND_URL=https://smarth-rlir.onrender.com

# Google OAuth
GOOGLE_CLIENT_ID=votre_google_client_id.apps.googleusercontent.com

# Seuils d'alerte
TEMP_MAX=35
GAS_PPM_MAX=400
```

> **Important :** Ne jamais committer le fichier `.env`. Il est dans `.gitignore`.

---

## 6. Configuration de la base de données (Neon PostgreSQL)

Le projet utilise **Neon** (PostgreSQL cloud serverless) — pas besoin d'installer PostgreSQL localement.

### Exécuter les migrations

```bash
# Migration 1 — schéma initial (toutes les tables de base)
npx ts-node scripts/migrate.ts

# Migration 2 — table invitations
npx ts-node scripts/migrate2.ts

# Migration 3 — historique actionneurs + index analytics
npx ts-node scripts/migrate3.ts
```

### Tables créées

| Table | Description |
|-------|-------------|
| `users` | Comptes utilisateurs avec vérification email, reset password et Google OAuth |
| `devices` | Appareils (capteurs INPUT et actionneurs OUTPUT) |
| `sensor_readings` | Relevés des capteurs (température, humidité, gaz, etc.) |
| `actuator_states` | État courant de chaque actionneur (ON/OFF) |
| `actuator_state_history` | Historique de chaque changement d'état (pour les statistiques de durée) |
| `alerts` | Alertes de sécurité générées par les capteurs |
| `automations` | Règles d'automatisation intelligente |
| `system_config` | Paramètres système (seuils, intervalles) |
| `invitations` | Invitations envoyées par un ADMIN à des utilisateurs ou invités |

### Schéma de la table `users` (étendu)

```sql
CREATE TABLE users (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(100) NOT NULL,
  email                   VARCHAR(150) UNIQUE NOT NULL,
  password                VARCHAR(255),             -- NULL pour les comptes Google-only
  role                    user_role DEFAULT 'USER',
  api_key                 VARCHAR(64) UNIQUE NOT NULL,

  -- Vérification email
  email_verified          BOOLEAN DEFAULT FALSE,
  email_verify_token      VARCHAR(128),
  email_verify_expires    TIMESTAMP,

  -- Réinitialisation du mot de passe
  reset_password_token    VARCHAR(128),
  reset_password_expires  TIMESTAMP,

  -- Google OAuth
  google_id               VARCHAR(100) UNIQUE,

  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);
```

### Configuration par défaut (`system_config`)

| Clé | Valeur | Description |
|-----|--------|-------------|
| `temp_max` | `35` | Seuil maximum de température (°C) |
| `gas_ppm_max` | `400` | Concentration maximale de gaz (ppm) |
| `light_threshold` | `100` | Luminosité pour l'éclairage automatique (lux) |
| `sensor_interval` | `300` | Intervalle de lecture ESP32 (secondes) |
| `auto_mode` | `true` | Activer les automatisations intelligentes |

---

## 7. Démarrage du serveur

```bash
# Développement (rechargement automatique)
npm run dev

# Production
npm run build && npm start
```

Le serveur démarre sur : `http://localhost:3000`  
Documentation Swagger : `http://localhost:3000/api-docs`  
Health check : `http://localhost:3000/health`

---

## 8. Système de rôles

Le système utilise trois rôles distincts :

| Rôle | Qui c'est | Permissions |
|------|-----------|-------------|
| `ADMIN` | Propriétaire de la maison | Tout : appareils, configuration, invitations, commandes |
| `USER` | Membre de la famille | Voir les données, envoyer des commandes aux actionneurs, résoudre des alertes |
| `GUEST` | Invité / accès limité | Lecture seule |

### Attribuer le rôle ADMIN au premier compte

Après la première inscription, exécuter dans la console Neon :

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'votre_email@example.com';
```

### Inviter d'autres utilisateurs

L'ADMIN peut ensuite inviter des membres via `POST /api/auth/invite` — un email avec un lien d'activation (48h) est envoyé automatiquement.

---

## 9. Endpoints REST API

### Authentification — `/api/auth`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| POST | `/api/auth/register` | Créer un compte → envoie email de vérification | Non |
| POST | `/api/auth/login` | Connexion → retourne JWT | Non |
| GET | `/api/auth/verify-email/:token` | Vérifier l'adresse email (lien dans l'email) | Non |
| POST | `/api/auth/forgot-password` | Demander un lien de réinitialisation | Non |
| POST | `/api/auth/reset-password` | Réinitialiser le mot de passe avec le token | Non |
| POST | `/api/auth/google` | Connexion / inscription via Google OAuth | Non |
| GET | `/api/auth/me` | Profil de l'utilisateur connecté + `api_key` | JWT |
| POST | `/api/auth/regenerate-api-key` | Régénérer l'`api_key` du compte | JWT |
| POST | `/api/auth/invite` | Inviter un USER ou GUEST par email | ADMIN |
| POST | `/api/auth/accept-invite` | Accepter une invitation et créer son compte | Non |
| GET | `/api/auth/invitations` | Lister les invitations envoyées | ADMIN |
| DELETE | `/api/auth/invitations/:id` | Annuler une invitation en attente | ADMIN |

**Inscription :**
```json
{ "name": "Alice", "email": "alice@smarthome.com", "password": "motdepasse1!" }
```

**Réponse inscription (201) :**
```json
{
  "message": "Compte créé avec succès. Veuillez vérifier votre email pour activer votre compte.",
  "api_key": "a3f8c2e1d4b7...",
  "user": { "id": 1, "name": "Alice", "email": "alice@smarthome.com", "role": "USER" }
}
```

> ⚠️ **L'`api_key` est retournée une seule fois.** La stocker immédiatement — elle sera flashée dans le firmware ESP32.

**Connexion :**
```json
{ "email": "alice@smarthome.com", "password": "motdepasse1!" }
```

**Réponse connexion (200) :**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "id": 1, "name": "Alice", "email": "alice@smarthome.com", "role": "USER" }
}
```

**Google OAuth :**
```json
{ "id_token": "<token Google ID obtenu côté client>" }
```

**Inviter un utilisateur :**
```json
{ "email": "bob@example.com", "role": "USER" }
```

**Accepter une invitation :**
```json
{ "token": "<token reçu par email>", "name": "Bob", "password": "motdepasse1!" }
```

---

### Appareils — `/api/devices`

> Table maître — tout capteur ou actionneur doit être enregistré ici avant utilisation.

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/devices` | Lister tous les appareils | JWT |
| GET | `/api/devices?type=INPUT` | Filtrer par type (INPUT/OUTPUT) | JWT |
| GET | `/api/devices?status=ONLINE` | Filtrer par statut | JWT |
| GET | `/api/devices?zone=salon` | Filtrer par zone | JWT |
| GET | `/api/devices/:id` | Obtenir un appareil par ID | JWT |
| POST | `/api/devices` | Ajouter un appareil → génère `device_key` | ADMIN |
| PUT | `/api/devices/:id` | Modifier nom, zone, description | ADMIN |
| PATCH | `/api/devices/:id/status` | Mettre à jour le statut (ONLINE/OFFLINE) | ADMIN |
| DELETE | `/api/devices/:id` | Supprimer un appareil (cascade) | ADMIN |

**Ajouter un appareil :**
```json
{ "name": "Capteur Gaz Salon", "type": "INPUT", "zone": "salon", "description": "Capteur MQ-2" }
```

**Réponse (201) — `device_key` retournée une seule fois :**
```json
{
  "message": "Appareil ajouté avec succès",
  "device": {
    "id": 3, "name": "Capteur Gaz Salon", "type": "INPUT",
    "zone": "salon", "device_key": "f7e3a1c9b2d4e5f6..."
  }
}
```

> ⚠️ **`device_key` à flasher dans l'ESP32 avec l'`api_key` du compte.**

---

### Capteurs — `/api/sensors`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/sensors/latest` | Dernier relevé de tous les capteurs | JWT |
| GET | `/api/sensors/history` | Historique paginé (`?from=&to=&page=&limit=`) | JWT |
| GET | `/api/sensors/device/:device_id` | Historique d'un capteur spécifique | JWT |
| GET | `/api/sensors/stats` | Statistiques min/max/moy par période | JWT |

**Paramètres de `/api/sensors/stats` :**

| Paramètre | Valeurs | Défaut |
|-----------|---------|--------|
| `period` | `day` · `week` · `month` · `year` | `day` |
| `device_id` | ID du capteur (optionnel) | tous |
| `limit` | 1–100 | 30 |

---

### Actionneurs — `/api/actuators`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/actuators` | État actuel de tous les actionneurs | JWT |
| POST | `/api/actuators/command` | Envoyer ON/OFF à un actionneur | USER |
| GET | `/api/actuators/stats` | Durée ON/OFF par période | JWT |

**Commande :**
```json
{ "device_id": 2, "state": true }
```

**Paramètres de `/api/actuators/stats` :**

| Paramètre | Valeurs | Défaut |
|-----------|---------|--------|
| `period` | `day` · `week` · `month` · `year` | `day` |
| `device_id` | ID de l'actionneur (optionnel) | tous |
| `limit` | 1–100 | 30 |

---

### Alertes — `/api/alerts`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/alerts` | Lister toutes les alertes (paginées) | JWT |
| GET | `/api/alerts?resolved=false` | Alertes non résolues uniquement | JWT |
| GET | `/api/alerts?severity=CRITICAL` | Filtrer par sévérité | JWT |
| GET | `/api/alerts?type=GAS_LEAK` | Filtrer par type | JWT |
| GET | `/api/alerts/:id` | Détails d'une alerte | JWT |
| PATCH | `/api/alerts/:id/resolve` | Marquer comme résolue | JWT |

**Types d'alerte :** `FIRE` · `GAS_LEAK` · `INTRUSION` · `WATER_LEAK` · `HIGH_TEMP` · `POWER_CUT`  
**Niveaux de sévérité :** `INFO` · `WARNING` · `CRITICAL`

---

### Automatisations — `/api/automations`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/automations` | Lister toutes les automatisations | JWT |
| GET | `/api/automations/:id` | Obtenir une automatisation | JWT |
| POST | `/api/automations` | Créer une règle | USER |
| PUT | `/api/automations/:id` | Modifier une règle | USER |
| DELETE | `/api/automations/:id` | Supprimer une règle | USER |
| PATCH | `/api/automations/:id/toggle` | Activer / désactiver | USER |

---

### Configuration système — `/api/config`

| Méthode | Endpoint | Description | Auth |
|---------|----------|-------------|------|
| GET | `/api/config` | Obtenir tous les paramètres | JWT |
| PUT | `/api/config/:key` | Modifier un paramètre | ADMIN |

**Clés disponibles :** `temp_max` · `gas_ppm_max` · `light_threshold` · `sensor_interval` · `auto_mode`

---

## 10. Statistiques et Analytiques

### Statistiques capteurs — `GET /api/sensors/stats`

Agrège les relevés de `sensor_readings` par période avec `date_trunc` PostgreSQL.

**Exemple de réponse (`?period=day`) :**
```json
{
  "period": "jour",
  "stats": [
    {
      "device_id": 1,
      "device_name": "Capteur Temp/Humidité Salon",
      "zone": "salon",
      "period_start": "2026-06-04T00:00:00.000Z",
      "temp_min": 21.5,  "temp_max": 31.2,  "temp_avg": 26.3,
      "humidity_min": 48.0, "humidity_max": 72.5, "humidity_avg": 60.1,
      "gas_ppm_min": 80.0,  "gas_ppm_max": 210.0, "gas_ppm_avg": 130.5,
      "air_quality_min": 88.0, "air_quality_max": 99.0, "air_quality_avg": 94.2,
      "light_lux_min": 0.0, "light_lux_max": 850.0, "light_lux_avg": 310.7,
      "motion_detections": 5,
      "water_leak_detections": 0,
      "reading_count": 288
    }
  ]
}
```

### Statistiques actionneurs — `GET /api/actuators/stats`

Calcule les durées ON/OFF à partir de `actuator_state_history` via une window function `LEAD`.

**Exemple de réponse (`?period=day`) :**
```json
{
  "period": "jour",
  "stats": [
    {
      "device_id": 2,
      "device_name": "Lumière Salon",
      "zone": "salon",
      "period_start": "2026-06-04T00:00:00.000Z",
      "on_duration_seconds": 18000,
      "off_duration_seconds": 68400,
      "on_duration_formatted": "5h 0min",
      "off_duration_formatted": "19h 0min",
      "toggle_count": 6,
      "on_count": 3,
      "off_count": 3
    }
  ]
}
```

> Chaque appel à `POST /api/actuators/command` enregistre automatiquement un événement dans `actuator_state_history`.

---

## 11. Événements WebSocket

Le serveur WebSocket fonctionne sur le **même port** que HTTP.  
URL WebSocket : `ws://localhost:3000`

Tous les messages sont des **chaînes JSON** avec un champ `type`.

---

### ESP32 → Serveur

#### Authentification (double vérification)

```json
{
  "type": "ESP32_AUTH",
  "api_key": "a3f8c2e1d4b7...",
  "device_key": "f7e3a1c9b2d4e5f6a7b8c9d0e1f2a3b4..."
}
```

**Logique de vérification :**
1. Chercher l'utilisateur par `api_key` → 401 si introuvable
2. Chercher le device par `device_key` → 401 si introuvable
3. Vérifier `device.owner_id === user.id` → 403 si non correspondant
4. Si valide → `AUTH_SUCCESS` + marquer le device `ONLINE`

#### Envoi des données capteurs

```json
{
  "type": "SENSOR_DATA",
  "reading": {
    "temperature": 28.5, "humidity": 65.2, "gas_ppm": 120.0,
    "motion": false, "light_lux": 85.0, "water_leak": false
  }
}
```

#### Envoi d'une alerte

```json
{ "type": "ALERT", "alert_type": "GAS_LEAK", "severity": "CRITICAL", "value": 520 }
```

---

### Dashboard → Serveur

```json
{ "type": "DASHBOARD_AUTH", "jwt_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

```json
{ "type": "COMMAND", "device_key": "LIGHT_SALON", "state": true }
```

---

### Serveur → Dashboard

```json
{
  "type": "SENSOR_UPDATE",
  "data": {
    "temperature": 28.5, "humidity": 65.2, "gas_ppm": 120.0,
    "motion": false, "light_lux": 85.0, "water_leak": false,
    "recorded_at": "2026-06-04T10:30:00Z"
  }
}
```

```json
{ "type": "ACTUATOR_UPDATE", "actuator": "LIGHT_SALON", "state": true, "timestamp": "..." }
```

```json
{
  "type": "NEW_ALERT",
  "alert_type": "GAS_LEAK", "zone": "kitchen",
  "severity": "CRITICAL", "alertId": 12, "timestamp": "..."
}
```

---

## 12. Intégration ESP32

### Correspondance capteurs/actionneurs et broches GPIO

| Capteur/Actionneur | GPIO | Protocole |
|--------------------|------|-----------|
| DHT22 (Temp/Humidité) | 4 | 1-Wire |
| MQ-2 (Gaz/Fumée) | 34 | Analogique |
| PIR (Mouvement) | 14 | Numérique |
| Capteur de fuite d'eau | 35 | Analogique |
| LDR (Luminosité) | 32 | Analogique |
| Relais — Lumière Salon | 26 | Numérique |
| Relais — Lumière Chambre | 27 | Numérique |
| Relais — Lumière Cuisine | 25 | Numérique |
| Relais — Lumière Extérieure | 33 | Numérique |
| Relais — Ventilateur | 19 | Numérique |
| Buzzer (Alarme) | 18 | Numérique |

---

## 13. Stratégie d'authentification et de sécurité

| Acteur | Mécanisme | Transmis via |
|--------|-----------|--------------|
| Dashboard / Frontend | JWT (24h) | Header `Authorization: Bearer <token>` |
| ESP32 (WebSocket) | `api_key` + `device_key` | Champ JSON dans `ESP32_AUTH` |
| ESP32 (REST optionnel) | `api_key` + `device_key` | Headers `X-API-Key` + `X-Device-Key` |

### Flux 1 — Inscription + vérification email

```
Frontend          API REST              Email
   │                  │                   │
   │── POST /register ▶│                   │
   │                  │── INSERT user ──▶DB│
   │◀── 201 {api_key} ─│                   │
   │                  │── sendVerificationEmail ──▶│
   │                  │                   │
   │ (clique sur lien dans l'email)        │
   │── GET /verify-email/:token ──────────▶│
   │◀── 200 email vérifié ─────────────────│
```

### Flux 2 — Connexion JWT

```
Frontend          API REST
   │── POST /login ──▶│
   │                  │ bcrypt.compare()
   │                  │ jwt.sign()
   │◀── 200 {token} ──│
```

### Flux 3 — Réinitialisation mot de passe

```
Frontend          API REST              Email
   │── POST /forgot-password ──▶│         │
   │                            │── sendPasswordResetEmail ──▶│
   │◀── 200 ────────────────────│         │
   │                            │         │
   │── POST /reset-password ────▶│         │
   │   {token, password}         │         │
   │◀── 200 ────────────────────│         │
```

### Flux 4 — Google OAuth

```
Frontend          API REST              Google
   │── POST /google {id_token} ──▶│        │
   │                              │── verifyIdToken ──▶│
   │                              │◀── payload ────────│
   │                              │ (crée ou connecte user)
   │◀── 200/201 {token} ──────────│
```

### Flux 5 — Invitation par l'ADMIN

```
ADMIN             API REST              Invité
   │── POST /invite ──▶│                   │
   │   {email, role}   │── email invite ──▶│
   │◀── 201 ───────────│                   │
   │                   │     (clique lien) │
   │                   │◀── POST /accept-invite ──│
   │                   │── INSERT user ─▶DB│
   │                   │◀── 201 {token} ──│
```

### Flux 6 — Connexion ESP32 (double clé)

```
ESP32             Serveur WS
   │── WS connect ─────▶│
   │── ESP32_AUTH ───────▶│
   │   {api_key,          │── SELECT user WHERE api_key ──▶DB
   │    device_key}       │── SELECT device WHERE device_key ──▶DB
   │                      │   Vérifier device.owner_id === user.id
   │                      │── UPDATE device status = 'ONLINE'
   │◀── AUTH_SUCCESS ─────│
```

---

## 14. Système d'alertes

Lorsque le serveur reçoit `SENSOR_DATA`, il vérifie les seuils depuis `system_config` :

| Condition | Type d'alerte | Sévérité | Action automatique |
|-----------|--------------|----------|--------------------|
| `gas_ppm > gas_ppm_max` | `GAS_LEAK` | CRITICAL | Email + broadcast |
| `temperature > temp_max` | `HIGH_TEMP` | WARNING | Allumer ventilateur |
| `motion == true` | `INTRUSION` | WARNING | Broadcast |
| `water_leak == true` | `WATER_LEAK` | CRITICAL | Email + broadcast |

---

## 15. Règles d'automatisation

| Déclencheur | Condition | Action |
|-------------|-----------|--------|
| Luminosité | `light_lux < 100` | Allumer lumières extérieure et salon |
| Température | `temperature > 35°C` | Allumer le ventilateur |
| Gaz | `gas_ppm > 400` | Allumer alarme, couper relais |
| Mouvement | `motion == true` (mode absent) | Déclencher alarme |
| Inactivité | Aucun mouvement 30 min | Éteindre toutes les lumières |
| Fuite d'eau | `water_leak == true` | Alerte critique, couper relais |

**Types de déclencheurs (`trigger_type`) :**
| Type | Champs utilisés |
|------|----------------|
| `SENSOR_THRESHOLD` | `trigger_device_id`, `trigger_condition`, `trigger_value` |
| `TIME_BASED` | `trigger_time` |
| `DEVICE_STATUS` | `trigger_device_id`, `trigger_condition` (`EQ`) |

---

## 16. Partage avec votre partenaire (ngrok)

```bash
# Terminal 1 — démarrer le backend
npm run dev

# Terminal 2 — exposer publiquement
ngrok http 3000
```

URLs fournies par ngrok :
```
HTTP:  http://a1b2c3d4.ngrok-free.app
HTTPS: https://a1b2c3d4.ngrok-free.app
```

> L'URL change à chaque redémarrage de ngrok (plan gratuit). Mettre à jour `base_url` dans Postman.

---

## 17. Documentation API avec Postman

### Collection

Le fichier `postman/SmartHome-Auth.postman_collection.json` contient tous les endpoints documentés avec exemples de réponses.

**Importer dans Postman (VS Code) :**
1. Cliquer sur l'icône Postman dans la barre latérale
2. **Collections** → **Import**
3. Sélectionner `postman/SmartHome-Auth.postman_collection.json`

### Variables de collection

| Variable | Valeur par défaut | Description |
|----------|-------------------|-------------|
| `base_url` | `https://smarth-rlir.onrender.com` | URL du backend |
| `jwt_token` | *(auto-rempli après login)* | Token JWT |
| `device_id` | *(auto-rempli après création)* | ID de l'appareil |
| `device_key` | *(auto-rempli après création)* | Clé de l'appareil |

### Structure de la collection

```
smarthome
├── Authentification
│   ├── POST  Inscription
│   ├── POST  Connexion              ← sauvegarde jwt_token automatiquement
│   ├── GET   Vérification de l'email
│   ├── POST  Mot de passe oublié
│   ├── POST  Réinitialisation du mot de passe
│   ├── POST  Connexion avec Google  ← sauvegarde jwt_token automatiquement
│   ├── GET   Mon profil
│   └── POST  Régénérer la clé API
├── Invitations
│   ├── POST   Envoyer une invitation (ADMIN)
│   ├── POST   Accepter une invitation
│   ├── GET    Lister les invitations (ADMIN)
│   └── DELETE Annuler une invitation (ADMIN)
├── Appareils
│   ├── GET    Lister les appareils
│   ├── GET    Obtenir un appareil
│   ├── POST   Ajouter un appareil (ADMIN) ← sauvegarde device_key automatiquement
│   ├── PUT    Modifier un appareil (ADMIN)
│   ├── PATCH  Mettre à jour le statut (ADMIN)
│   └── DELETE Supprimer un appareil (ADMIN)
├── Capteurs
│   ├── GET  Dernier relevé
│   ├── GET  Statistiques min/max/moy
│   ├── GET  Historique (paginé)
│   └── GET  Historique par appareil
├── Actionneurs
│   ├── GET   État de tous les actionneurs
│   ├── GET   Statistiques durée ON/OFF
│   └── POST  Envoyer une commande
├── Alertes
│   ├── GET   Lister les alertes
│   ├── GET   Obtenir une alerte
│   └── PATCH Résoudre une alerte
└── Configuration
    ├── GET Obtenir la configuration
    └── PUT Modifier une configuration (ADMIN)
```

---

## 18. Déploiement (Render / VPS)

### Render (déployé)

Le backend est déjà déployé sur : **https://smarth-rlir.onrender.com**

**Configuration Render :**
- Build command : `npm run build`
- Start command : `npm start`
- Variables d'environnement : toutes les variables du `.env` (sauf `NODE_ENV=production`)

### VPS (Option alternative)

```bash
git clone https://github.com/Modsontech45/smarth.git
cd smarth
npm install
npm run build

# PM2 pour maintenir le serveur actif
npm install -g pm2
pm2 start dist/index.js --name smarthome-api
pm2 save && pm2 startup
```

---

## Liste de démarrage rapide

- [ ] Cloner le dépôt et exécuter `npm install`
- [ ] Copier `.env.example` → `.env` et remplir les valeurs
- [ ] Exécuter les 3 migrations (`migrate.ts`, `migrate2.ts`, `migrate3.ts`)
- [ ] Promouvoir le premier compte en ADMIN via SQL
- [ ] Exécuter `npm run dev`
- [ ] Ouvrir `http://localhost:3000/api-docs`
- [ ] Importer la collection Postman
- [ ] Flasher l'ESP32 avec `api_key` + `device_key`
- [ ] Lancer `ngrok http 3000` si partage avec un partenaire

---

*SmartHome Secure — PPE 2025*
