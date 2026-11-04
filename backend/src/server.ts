import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
);

// Redis & BullMQ Escalation Queue
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

export const escalationQueue = new Queue('taskflow-escalation', {
  connection: redisConnection,
});

/**
 * Verifica se o horário atual está dentro do Horário de Silêncio do usuário
 */
function isWithinQuietHours(quietStart = '22:00', quietEnd = '07:00'): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = quietStart.split(':').map(Number);
  const [endH, endM] = quietEnd.split(':').map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  if (startTotal <= endTotal) {
    return currentMinutes >= startTotal && currentMinutes <= endTotal;
  }
  return currentMinutes >= startTotal || currentMinutes <= endTotal;
}

/**
 * Envia lembrete interativo pelo Telegram Bot API com botões inline
 */
export async function sendTelegramTaskReminder(params: {
  botToken: string;
  chatId: string;
  taskId: string;
  title: string;
  dateFormatted: string;
  startTime: string;
  priorityLabel: string;
  stageLabel: string;
}) {
  const text =
    `🔔 *TASKFLOW – LEMBRETE DE COMPROMISSO*\n\n` +
    `Olá! 👋 Você tem uma tarefa agendada (${params.stageLabel}).\n\n` +
    `📌 *Atividade:* ${params.title}\n` +
    `📅 *Data:* ${params.dateFormatted}\n` +
    `⏰ *Horário:* ${params.startTime}\n` +
    `⚡ *Prioridade:* ${params.priorityLabel}\n\n` +
    `Não esqueça seu compromisso!\n\n` +
    `*Você confirma que recebeu este lembrete?*`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ CONFIRMAR', callback_data: `CONFIRM:${params.taskId}` },
      ],
      [
        { text: '⏰ ADIAR 10 MIN', callback_data: `SNOOZE_10:${params.taskId}` },
        { text: '⏰ ADIAR 30 MIN', callback_data: `SNOOZE_30:${params.taskId}` },
      ],
      [
        { text: '❌ CANCELAR ALERTA', callback_data: `CANCEL:${params.taskId}` },
      ],
    ],
  };

  const response = await fetch(
    `https://api.telegram.org/bot${params.botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard,
      }),
    }
  );

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.description || 'Falha ao enviar mensagem pelo Telegram');
  }
  return data.result;
}

/**
 * Envia alerta de 5 minutos antes via WhatsApp (Evolution API / Z-API / Twilio WhatsApp)
 */
export async function sendWhatsAppTaskReminder(params: {
  provider?: 'evolution' | 'twilio';
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionInstance?: string;
  accountSid?: string;
  authToken?: string;
  fromWhatsApp?: string;
  toPhone: string;
  taskId: string;
  title: string;
  dateFormatted: string;
  startTime: string;
  priorityLabel: string;
}) {
  const messageText =
    `🟢 *TASKFLOW – FALTAM 5 MINUTOS!* ⏰\n\n` +
    `Olá! Sua atividade começa em *5 minutos*:\n\n` +
    `📌 *Tarefa:* ${params.title}\n` +
    `📅 *Data:* ${params.dateFormatted}\n` +
    `⏰ *Início:* ${params.startTime}\n` +
    `⚡ *Prioridade:* ${params.priorityLabel}\n\n` +
    `Responda *1* para CONFIRMAR ou *2* para ADIAR 10 MIN.\n` +
    `⚠️ _Se não confirmar, ligaremos para você automaticamente!_`;

  if (params.evolutionApiUrl && params.evolutionApiKey && params.evolutionInstance) {
    const cleanPhone = params.toPhone.replace(/\D/g, '');
    const res = await fetch(
      `${params.evolutionApiUrl.replace(/\/$/, '')}/message/sendText/${params.evolutionInstance}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: params.evolutionApiKey,
        },
        body: JSON.stringify({
          number: cleanPhone,
          text: messageText,
        }),
      }
    );
    return await res.json();
  }

  if (params.accountSid && params.authToken && params.fromWhatsApp) {
    const client = twilio(params.accountSid, params.authToken);
    const toFmt = params.toPhone.startsWith('whatsapp:')
      ? params.toPhone
      : `whatsapp:${params.toPhone}`;
    const fromFmt = params.fromWhatsApp.startsWith('whatsapp:')
      ? params.fromWhatsApp
      : `whatsapp:${params.fromWhatsApp}`;
    return await client.messages.create({
      from: fromFmt,
      to: toFmt,
      body: messageText,
    });
  }

  throw new Error('Configure Evolution API ou Twilio WhatsApp para envio externo.');
}

/**
 * Envia SMS tradicional faltando 5 minutos para o início da tarefa (Twilio SMS)
 */
export async function sendSmsTaskReminder(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  title: string;
  startTime: string;
}) {
  const client = twilio(params.accountSid, params.authToken);
  const body = `TASKFLOW [FALTAM 5 MIN]: Sua atividade "${params.title}" inicia as ${params.startTime}. Confirme no app/Telegram ou ligaremos automaticamente.`;
  return await client.messages.create({
    from: params.fromNumber,
    to: params.toNumber,
    body,
  });
}

/**
 * Realiza ligação telefônica automática real via Twilio Programmable Voice com DTMF
 */
export async function initiateTwilioVoiceCall(params: {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  taskId: string;
  title: string;
  startTime: string;
  customVoiceTemplate?: string;
}) {
  const client = twilio(params.accountSid, params.authToken);

  const voiceUrl = new URL(`${PUBLIC_BASE_URL}/api/webhooks/twilio/voice`);
  voiceUrl.searchParams.set('taskId', params.taskId);
  voiceUrl.searchParams.set('title', params.title);
  voiceUrl.searchParams.set('startTime', params.startTime);
  if (params.customVoiceTemplate) {
    voiceUrl.searchParams.set('template', params.customVoiceTemplate);
  }

  const statusCallbackUrl = new URL(`${PUBLIC_BASE_URL}/api/webhooks/twilio/status`);
  statusCallbackUrl.searchParams.set('taskId', params.taskId);

  const call = await client.calls.create({
    to: params.toNumber,
    from: params.fromNumber,
    url: voiceUrl.toString(),
    statusCallback: statusCallbackUrl.toString(),
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    timeout: 35,
  });

  return call;
}

/**
 * Cancela todos os jobs futuros da tarefa quando o usuário confirma
 */
async function cancelPendingEscalationJobs(taskId: string) {
  const delayedJobs = await escalationQueue.getDelayed();
  for (const job of delayedJobs) {
    if (job.data?.taskId === taskId) {
      await job.remove();
    }
  }
}

// ============================================================================
// WEBHOOKS DO TELEGRAM BOT (RECEBIMENTO DOS BOTÕES INTERATIVOS)
// ============================================================================
app.post('/api/webhooks/telegram', async (req: Request, res: Response) => {
  try {
    const callbackQuery = req.body?.callback_query;
    if (!callbackQuery?.data) {
      return res.status(200).json({ ok: true });
    }

    const [action, taskId] = String(callbackQuery.data).split(':');
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (action === 'CONFIRM') {
      await cancelPendingEscalationJobs(taskId);
      await supabase
        .from('tasks')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_via: 'telegram',
        })
        .eq('id', taskId);

      if (botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: '✅ Compromisso confirmado! Ligações automáticas desativadas.',
          }),
        });
      }
    } else if (action === 'SNOOZE_10' || action === 'SNOOZE_30') {
      const minutes = action === 'SNOOZE_10' ? 10 : 30;
      await cancelPendingEscalationJobs(taskId);
      await escalationQueue.add(
        'escalate-step',
        { taskId, channel: 'telegram', stageLabel: `Adiado por ${minutes} min` },
        { delay: minutes * 60 * 1000 }
      );
    } else if (action === 'CANCEL') {
      await cancelPendingEscalationJobs(taskId);
      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('id', taskId);
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// WEBHOOKS DA TWILIO VOICE API (TwiML + RECONHECIMENTO DE TECLA DTMF "1")
// ============================================================================
app.post('/api/webhooks/twilio/voice', (req: Request, res: Response) => {
  const taskId = String(req.query.taskId || '');
  const title = String(req.query.title || 'compromisso importante');
  const startTime = String(req.query.startTime || 'agora');
  const customTemplate = String(req.query.template || '');

  const twiml = new twilio.twiml.VoiceResponse();

  const gatherUrl = `${PUBLIC_BASE_URL}/api/webhooks/twilio/gather?taskId=${encodeURIComponent(
    taskId
  )}&title=${encodeURIComponent(title)}`;

  const gather = twiml.gather({
    numDigits: 1,
    action: gatherUrl,
    method: 'POST',
    timeout: 8,
  });

  const spokenMessage = customTemplate
    ? customTemplate
        .replace('{titulo}', title)
        .replace('{horario}', startTime)
    : `Olá! Este é o seu assistente TaskFlow. Você possui um compromisso agendado. Sua tarefa é ${title}, marcada para as ${startTime}. Para confirmar o recebimento, pressione a tecla 1. Para adiar por 10 minutos, pressione a tecla 2.`;

  gather.say(
    {
      language: 'pt-BR',
      voice: 'Polly.Camila',
    },
    spokenMessage
  );

  // Caso o usuário não digite nada dentro do timeout
  twiml.say(
    { language: 'pt-BR', voice: 'Polly.Camila' },
    'Não identificamos sua confirmação. Tentaremos entrar em contato novamente em breve. Até logo!'
  );
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/api/webhooks/twilio/gather', async (req: Request, res: Response) => {
  const digits = String(req.body.Digits || '');
  const taskId = String(req.query.taskId || '');
  const callSid = String(req.body.CallSid || '');

  const twiml = new twilio.twiml.VoiceResponse();

  if (digits === '1') {
    await cancelPendingEscalationJobs(taskId);
    await supabase
      .from('tasks')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_via: 'voice_dtmf',
      })
      .eq('id', taskId);

    await supabase
      .from('call_logs')
      .update({
        call_status: 'confirmed_dtmf',
        dtmf_digit: '1',
      })
      .eq('provider_call_sid', callSid);

    twiml.say(
      { language: 'pt-BR', voice: 'Polly.Camila' },
      'Perfeito! Recebimento confirmado com sucesso. Todos os alertas adicionais foram encerrados. Tenha um excelente compromisso!'
    );
    twiml.hangup();
  } else if (digits === '2') {
    await cancelPendingEscalationJobs(taskId);
    await escalationQueue.add(
      'escalate-step',
      { taskId, channel: 'voice_call', stageLabel: 'Adiado por DTMF (10 min)' },
      { delay: 10 * 60 * 1000 }
    );
    twiml.say(
      { language: 'pt-BR', voice: 'Polly.Camila' },
      'Entendido! Vamos ligar novamente em 10 minutos.'
    );
    twiml.hangup();
  } else {
    twiml.say(
      { language: 'pt-BR', voice: 'Polly.Camila' },
      'Opção inválida. Encerrando chamada.'
    );
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ============================================================================
// ENDPOINT DIRETO PARA DISPARO DE TESTE REAL DE LIGAÇÃO E TELEGRAM
// ============================================================================
app.post('/api/dispatch/telegram', async (req: Request, res: Response) => {
  try {
    const result = await sendTelegramTaskReminder(req.body);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/dispatch/whatsapp', async (req: Request, res: Response) => {
  try {
    const result = await sendWhatsAppTaskReminder(req.body);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/dispatch/sms', async (req: Request, res: Response) => {
  try {
    const result = await sendSmsTaskReminder(req.body);
    res.json({ ok: true, sid: result.sid, status: result.status });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/dispatch/voice-call', async (req: Request, res: Response) => {
  try {
    const call = await initiateTwilioVoiceCall(req.body);
    res.json({ ok: true, callSid: call.sid, status: call.status });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 TaskFlow Backend & Escalation Engine rodando na porta ${PORT}`);
});
