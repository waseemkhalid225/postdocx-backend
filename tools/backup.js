// tools/backup.js — export the application tables to one JSON file (service role required).
// Usage: node tools/backup.js [outDir]
const fs = require('fs'); const path = require('path');
const { admin } = require('../lib/supa');
const TABLES = ['profiles', 'opportunities', 'applications', 'documents', 'payments', 'credit_ledger', 'support_tickets', 'organisations', 'org_members', 'clients', 'client_tasks', 'client_notes', 'commission_ledger', 'org_subscriptions', 'offers', 'interview_preps', 'visa_rules', 'visa_cases', 'journey_tasks', 'partner_openings', 'application_shares', 'service_partners', 'org_api_keys', 'org_domains', 'org_webhooks', 'app_settings'];
(async () => {
  const out = { at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const rows = []; let from = 0;
    while (true) { const { data, error } = await admin().from(t).select('*').range(from, from + 999); if (error) { out.tables[t] = { error: error.message }; break; } rows.push(...(data || [])); if (!data || data.length < 1000) break; from += 1000; }
    if (!out.tables[t]) out.tables[t] = rows;
    console.log(t, Array.isArray(out.tables[t]) ? out.tables[t].length : out.tables[t]);
  }
  const dir = process.argv[2] || 'backups'; fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ff-' + new Date().toISOString().slice(0, 10) + '.json'); fs.writeFileSync(file, JSON.stringify(out));
  console.log('written', file, Math.round(fs.statSync(file).size / 1024) + ' KB');
})().catch(e => { console.error(e); process.exit(1); });
