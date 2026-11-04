# 🚀 TASKFLOW – SMART REMINDER

> **"Organize seu tempo. Não perca nenhum compromisso."**  
> Plataforma SaaS inteligente que combina **Google Agenda + Gerenciador Avançado de Tarefas + Assistente IA em Linguagem Natural + Motor de Escalonamento Persistente (Telegram Bot → Ligação Telefônica Automática com Voz e Confirmação DTMF Tecla 1)**.

---

## ⚡ Como Executar Imediatamente (Zero-Build)

Você pode abrir e testar todos os fluxos da plataforma instantaneamente no seu navegador:

1. Abra o arquivo [`index.html`](./index.html) (ou [`preview-instantaneo.html`](./preview-instantaneo.html)) diretamente no Chrome / Edge.
2. Teste o diferencial principal clicando no botão **"🔥 Simular Escalonamento (Telegram → Ligação)"** no topo do Dashboard:
   - **Passo 1:** O sistema dispara o lembrete do **TaskFlow Bot no Telegram** com os botões interativos (`✅ CONFIRMAR`, `⏰ ADIAR 10 MIN`, `⏰ ADIAR 30 MIN`, `❌ CANCELAR ALERTA`).
   - **Passo 2:** Se você não confirmar em 6 segundos (ou clicar em **"📞 Ignorar → Ligar Agora"**), o sistema escala a cobrança e inicia uma **Ligação Telefônica Automática** com toque real.
   - **Passo 3:** Ao clicar em **"📞 Atender Agora"**, o assistente reproduz a mensagem de voz em português:  
     *"Olá! Este é o seu assistente TaskFlow. Você possui um compromisso agendado... Para confirmar o recebimento, pressione a tecla 1."*
   - **Passo 4:** Pressione a **Tecla `1`** no teclado numérico (DTMF) para confirmar o recebimento, encerrar a chamada e interromper os próximos alertas!

---

## ✈️ Como Receber Alertas Reais no Seu Telegram (1 Minuto)

A interface já possui integração HTTP direta com a **API oficial do Telegram Bot** (`sendMessage` com `inline_keyboard` + `getUpdates` polling em tempo real):

1. No Telegram, abra o **[@BotFather](https://t.me/BotFather)**, envie `/newbot` e copie o **Bot Token**.
2. Envie uma mensagem `"Oi"` ou `/start` para o seu novo Bot no Telegram.
3. No **TaskFlow**, acesse a aba **⚙️ Configurações**:
   - Cole o **Telegram Bot Token**.
   - Clique em **"🔍 Detectar Meu Chat ID"** (o sistema preencherá seu Chat ID automaticamente).
   - Clique em **"✈️ Testar Envio de Alerta com Botões no Telegram"**.
4. Você receberá a mensagem no seu celular! Ao tocar em **✅ CONFIRMAR** dentro do Telegram, o status da tarefa no TaskFlow muda automaticamente para **Confirmada** e desativa a ligação telefônica.

---

## 🏗️ Arquitetura Full-Stack do Projeto

- [`index.html`](./index.html) / [`preview-instantaneo.html`](./preview-instantaneo.html) — Aplicação SaaS completa e responsiva (Dashboard, Calendário Inteligente com Dia/Semana/Mês/Lista e Drag & Drop, Cadastro Avançado de Tarefas, Central de Alertas e Ligações, Assistente Inteligente em Linguagem Natural, Relatórios com Índice de Comprometimento e Configurações).
- [`supabase/schema.sql`](./supabase/schema.sql) — Schema PostgreSQL / Supabase completo (`user_profiles`, `categories`, `tasks`, `notification_logs`, `call_logs` e políticas de segurança RLS).
- [`backend/src/server.ts`](./backend/src/server.ts) — Servidor Node.js + Express + **BullMQ (Redis)** + **Telegram Bot Webhook** + **Twilio Programmable Voice Webhooks** (`/api/webhooks/twilio/voice` e `/api/webhooks/twilio/gather` com reconhecimento DTMF `Digits === '1'`).
- [`backend/.env.example`](./backend/.env.example) — Variáveis de ambiente para deploy em produção.
