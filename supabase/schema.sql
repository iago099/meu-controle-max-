-- ============================================================================
-- TASKFLOW – SMART REMINDER
-- PostgreSQL / Supabase Production Schema
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PERFIS E CONFIGURAÇÕES DO USUÁRIO
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID UNIQUE,
    full_name VARCHAR(120) NOT NULL DEFAULT 'Carlos Mendes',
    email VARCHAR(180) UNIQUE NOT NULL DEFAULT 'carlos@taskflow.app',
    phone_number VARCHAR(30) DEFAULT '+5511999999999',
    avatar_url TEXT,
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    theme VARCHAR(16) NOT NULL DEFAULT 'dark',
    -- Integração Telegram
    telegram_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    telegram_bot_token TEXT,
    telegram_chat_id VARCHAR(64),
    telegram_username VARCHAR(64),
    -- Integração WhatsApp (Evolution API / Z-API / Twilio WhatsApp / Cloud API)
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    whatsapp_provider VARCHAR(32) NOT NULL DEFAULT 'evolution_or_twilio',
    whatsapp_api_url TEXT,
    whatsapp_api_key TEXT,
    whatsapp_instance VARCHAR(80),
    whatsapp_number VARCHAR(30) DEFAULT '+5511999999999',
    -- Integração SMS Direto (Twilio SMS / Zenvia)
    sms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- Integração Telefonia (Twilio / SIP)
    voice_call_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    twilio_account_sid VARCHAR(120),
    twilio_auth_token TEXT,
    twilio_from_number VARCHAR(30),
    custom_voice_template TEXT NOT NULL DEFAULT 'Olá! Este é o seu assistente TaskFlow. Você possui um compromisso agendado. Sua tarefa é {titulo}, marcada para as {horario}. Para confirmar o recebimento, pressione a tecla 1.',
    -- Regras Globais de Escalonamento e Silêncio
    quiet_hours_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    quiet_hours_start TIME NOT NULL DEFAULT '22:00',
    quiet_hours_end TIME NOT NULL DEFAULT '07:00',
    wait_minutes_before_call INTEGER NOT NULL DEFAULT 10,
    call_retry_interval_minutes INTEGER NOT NULL DEFAULT 5,
    max_call_attempts INTEGER NOT NULL DEFAULT 3,
    weekly_goal_tasks INTEGER NOT NULL DEFAULT 25,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. CATEGORIAS PERSONALIZÁVEIS
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    slug VARCHAR(40) NOT NULL,
    name VARCHAR(60) NOT NULL,
    emoji VARCHAR(12) NOT NULL,
    color_hex VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TAREFAS E COMPROMISSOS
CREATE TYPE task_priority AS ENUM ('urgent', 'high', 'medium', 'low');
CREATE TYPE task_status AS ENUM (
    'pending',
    'notified',
    'confirmed',
    'in_progress',
    'completed',
    'overdue',
    'cancelled'
);
CREATE TYPE recurrence_type AS ENUM ('none', 'daily', 'weekly', 'monthly', 'custom');

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    task_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    category VARCHAR(40) NOT NULL DEFAULT 'work',
    priority task_priority NOT NULL DEFAULT 'high',
    status task_status NOT NULL DEFAULT 'pending',
    location TEXT,
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    recurrence recurrence_type NOT NULL DEFAULT 'none',
    recurrence_custom_rule VARCHAR(120),
    -- Configuração de Alertas e Escalonamento da Tarefa (Disparo Principal T - 5 min)
    lead_time_minutes INTEGER NOT NULL DEFAULT 5,
    notify_whatsapp BOOLEAN NOT NULL DEFAULT TRUE,
    notify_telegram BOOLEAN NOT NULL DEFAULT TRUE,
    notify_sms BOOLEAN NOT NULL DEFAULT TRUE,
    notify_voice_call BOOLEAN NOT NULL DEFAULT TRUE,
    require_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
    custom_voice_message TEXT,
    escalation_steps JSONB NOT NULL DEFAULT '[
        {"offsetMinutes": -5,  "channel": "whatsapp_telegram_sms", "label": "5 min antes: Disparo simultâneo WhatsApp + Telegram + SMS"},
        {"offsetMinutes": -2,  "channel": "whatsapp_telegram",     "label": "2 min antes: Cobrança urgente sem confirmação"},
        {"offsetMinutes": 0,   "channel": "voice_call",            "label": "No horário: Ligação telefônica automática (DTMF Tecla 1)"}
    ]'::jsonb,
    current_escalation_stage INTEGER NOT NULL DEFAULT 0,
    call_attempts_count INTEGER NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    rescheduled_count INTEGER NOT NULL DEFAULT 0,
    estimated_minutes INTEGER NOT NULL DEFAULT 45,
    confirmed_at TIMESTAMPTZ,
    confirmed_via VARCHAR(32), -- 'telegram', 'voice_dtmf', 'web_app'
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON public.tasks(user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);

-- 4. HISTÓRICO DE NOTIFICAÇÕES (TELEGRAM / PUSH / SISTEMA)
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    task_title VARCHAR(200) NOT NULL,
    channel VARCHAR(32) NOT NULL, -- 'telegram', 'voice_call', 'system'
    stage_label VARCHAR(120) NOT NULL,
    message_preview TEXT,
    delivery_status VARCHAR(32) NOT NULL DEFAULT 'sent', -- 'sent', 'delivered', 'confirmed', 'snoozed', 'failed'
    user_response VARCHAR(64), -- 'CONFIRMAR', 'ADIAR_10', 'ADIAR_30', 'CANCELAR', 'DTMF_1'
    external_message_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. HISTÓRICO DE LIGAÇÕES TELEFÔNICAS AUTOMÁTICAS (TWILIO / VOZ)
CREATE TABLE IF NOT EXISTS public.call_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    task_title VARCHAR(200) NOT NULL,
    to_number VARCHAR(30) NOT NULL,
    provider_call_sid VARCHAR(100),
    attempt_number INTEGER NOT NULL DEFAULT 1,
    call_status VARCHAR(32) NOT NULL, -- 'initiated', 'ringing', 'answered', 'confirmed_dtmf', 'no_answer', 'failed'
    dtmf_digit VARCHAR(8),
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    spoken_script TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. AUDITORIA E SEGURANÇA (RLS)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Isolamento de dados por usuario - tasks"
    ON public.tasks
    FOR ALL
    USING (auth.uid() = auth_user_id OR user_id IS NOT NULL);
