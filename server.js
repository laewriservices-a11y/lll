const http = require('http');
const fs = require('fs');
const path = require('path');

// ── CONFIG ── vul dit in ──
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1506375962030248151/Pd05LIa5rdL9PvRBtc1i19u98JRczgRrws1hcdprnyr3alrOEGU0TL0d_lU-O_JuhU-k';
const WEBHOOK_ID  = WEBHOOK_URL.split('/').at(-2);
const WEBHOOK_TOKEN = WEBHOOK_URL.split('/').at(-1);
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── STATE ──
let state = { totalVisitors: 0, messageId: null };
let liveVisitors = new Map(); // sessionId → timestamp

// Laad opgeslagen state
if (fs.existsSync(DATA_FILE)) {
    try { state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
}

function saveState() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state), 'utf8');
}

// ── DISCORD API ──
async function discordRequest(method, endpoint, body) {
    const { default: fetch } = await import('node-fetch');
    const res = await fetch(`https://discord.com/api/v10${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    return res.json();
}

function buildEmbed() {
    const live = liveVisitors.size;
    const now = new Date().toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' });
    return {
        embeds: [{
            color: 0xcc0000,
            author: { name: '📊 MythicBrawl — Live Dashboard' },
            fields: [
                { name: '🟢 Nu online',       value: `**${live}**`,              inline: true },
                { name: '👥 Totaal bezoekers', value: `**${state.totalVisitors}**`, inline: true },
                { name: '🕐 Laatst bijgewerkt', value: now,                       inline: false },
            ],
            footer: { text: 'MythicBrawl Analytics' },
            timestamp: new Date().toISOString()
        }]
    };
}

async function updateDashboard() {
    const embed = buildEmbed();
    if (!state.messageId) {
        // Eerste keer: stuur nieuw bericht
        const res = await discordRequest('POST', `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}?wait=true`, embed);
        if (res && res.id) {
            state.messageId = res.id;
            saveState();
            console.log('Dashboard bericht aangemaakt, ID:', res.id);
        }
    } else {
        // Edit bestaand bericht
        await discordRequest('PATCH', `/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}/messages/${state.messageId}`, embed);
    }
}

// ── CORS HELPER ──
function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
    cors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        let data = {};
        try { data = JSON.parse(body); } catch {}

        // POST /visit — nieuwe bezoeker
        if (req.method === 'POST' && req.url === '/visit') {
            const { sessionId } = data;
            if (!sessionId) { res.writeHead(400); res.end(); return; }

            if (!liveVisitors.has(sessionId)) {
                state.totalVisitors++;
                saveState();
            }
            liveVisitors.set(sessionId, Date.now());

            await updateDashboard();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // POST /leave — bezoeker weg
        if (req.method === 'POST' && req.url === '/leave') {
            const { sessionId } = data;
            if (sessionId) liveVisitors.delete(sessionId);

            await updateDashboard();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        // POST /ping — heartbeat (houdt sessie alive)
        if (req.method === 'POST' && req.url === '/ping') {
            const { sessionId } = data;
            if (sessionId && liveVisitors.has(sessionId)) {
                liveVisitors.set(sessionId, Date.now());
            }
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        res.writeHead(404);
        res.end();
    });
});

// Verwijder inactieve sessies elke 30 sec (geen ping ontvangen in 35 sec)
setInterval(async () => {
    const cutoff = Date.now() - 35000;
    let changed = false;
    for (const [id, ts] of liveVisitors) {
        if (ts < cutoff) { liveVisitors.delete(id); changed = true; }
    }
    if (changed) await updateDashboard();
}, 30000);

server.listen(PORT, () => console.log(`MythicBrawl backend draait op poort ${PORT}`));
