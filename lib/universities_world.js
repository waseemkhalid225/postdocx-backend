// lib/universities_world.js — 10,259 universities in 200 countries (open Hipo university-domains list, shipped with the
// build) with 6,457 in the 54 destinations. Seeded into the institutions table in batches; verified by DNS and
// reachability by the acquisition engine; flagship seeds keep priority for names that already exist.
const { admin } = require('./supa'); let CACHE = null;
function all() { if (!CACHE) CACHE = require('../data/world_universities.json'); return CACHE; }
async function seed(onlyDestinations) { const P = Object.keys(require('./visa_portals').PORTALS); const rows = all().filter(u => !onlyDestinations || P.includes(u.cc)).map(u => ({ country_code: u.cc, name: String(u.n).slice(0, 200), domain: u.d, website: u.w || ('https://' + u.d), kind: 'university', source: 'registry', registry: 'hipo_world_universities', city: u.s || null })); let n = 0; for (let i = 0; i < rows.length; i += 400) { const { error } = await admin().from('institutions').upsert(rows.slice(i, i + 400), { onConflict: 'country_code,name', ignoreDuplicates: true }); if (!error) n += Math.min(400, rows.length - i); } return { rows: rows.length, inserted_or_kept: n }; }
function count(cc) { return all().filter(u => !cc || u.cc === cc).length; }
module.exports = { all, seed, count };
