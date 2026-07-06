import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { verifyJWT } from '../middleware/auth.middleware';

const router = Router();
const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

interface ActuatorInfo { id: number; name: string; room: string; state: boolean }
interface SensorInfo   { name: string; value: string | number | boolean; unit?: string }
interface HistoryEntry { userText: string; reply: string }

router.post('/interpret', verifyJWT, async (req: Request, res: Response) => {
  const { transcript, actuators, history, sensors } = req.body as {
    transcript: string;
    actuators:  ActuatorInfo[];
    history?:   HistoryEntry[];
    sensors?:   SensorInfo[];
  };

  if (!transcript?.trim()) {
    return void res.status(400).json({ error: 'transcript is required' });
  }

  const deviceList = Array.isArray(actuators) && actuators.length > 0
    ? actuators.map(a =>
        `- ${a.name} (id:${a.id}, pièce:${a.room ?? '?'}, état:${a.state ? 'allumé' : 'éteint'})`
      ).join('\n')
    : '(aucun appareil enregistré)';

  const sensorBlock = Array.isArray(sensors) && sensors.length > 0
    ? '\n\nDonnées capteurs en temps réel :\n' +
      sensors.map(s => `- ${s.name} : ${s.value}${s.unit ? ' ' + s.unit : ''}`).join('\n')
    : '';

  const historyBlock = Array.isArray(history) && history.length > 0
    ? '\n\nHistorique récent de la conversation :\n' +
      history.slice(-4).filter(h => h.userText).map(h =>
        `Utilisateur : "${h.userText}"\nSkylorx : "${h.reply}"`
      ).join('\n---\n')
    : '';

  const systemPrompt =
`Tu es Skylorx, un assistant vocal pour maison intelligente. Tu réponds TOUJOURS en français, avec un ton naturel et chaleureux.
Tu reçois une commande vocale ou texte et tu as accès à la liste des appareils domotiques ainsi qu'aux données capteurs.

Réponds UNIQUEMENT avec un objet JSON valide (sans markdown, sans texte autour) :
{
  "action": "on" | "off" | "status" | "greeting" | "query" | null,
  "targets": [{"id": <number>, "name": "<string>", "room": "<string>"}],
  "reply": "<réponse naturelle en français>"
}

Règles :
- "on"       → allumer les appareils ciblés dans targets
- "off"      → éteindre les appareils ciblés dans targets
- "status"   → rapport sur l'état des appareils (targets vide = tout rapporter)
- "greeting" → salutation simple, targets vide
- "query"    → question sur la maison ou les capteurs ; réponse dans reply, targets vide
- null       → commande incompréhensible, targets vide, reply explique poliment
- Sois naturel et concis dans reply (1-2 phrases maximum).
- Si la commande vise "tout" ou "tous", mets TOUS les appareils dans targets.
- Utilise l'historique pour résoudre les pronoms et références ("l'éteindre", "celle-ci", "les deux").
- Pour les questions sur température, humidité, gaz, lumière ou mouvement : utilise les données capteurs.

Appareils disponibles :
${deviceList}${sensorBlock}${historyBlock}`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(transcript);
    const raw    = result.response.text().trim();
    const json   = raw.startsWith('```')
      ? raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      : raw;
    const parsed = JSON.parse(json);

    res.json({
      action:  parsed.action  ?? null,
      targets: Array.isArray(parsed.targets) ? parsed.targets : [],
      reply:   typeof parsed.reply === 'string' ? parsed.reply : 'Compris.',
    });
  } catch (err: any) {
    console.error('[Skylorx] Gemini error:', err.message);
    res.status(500).json({ action: null, targets: [], reply: 'Désolé, une erreur s\'est produite.' });
  }
});

export default router;
