const API_KEY = '797669ca9b17057d98.84848183';
const BASE = 'https://enerflo.io';

const MANAGERS = [
  'Jacari Brown','Marcelino Huizar','Christopher Chavez','Daxtonn Delatore','Brandon L Jackson',
  'Mark Lennox','Madison Marinkovich','Joshua Honea','Cayden Larsen','Tate Garff',
  'Jacob Tyler Keim','Casey Moshier','Mason Criddle','Adrian Trevino','Evan Droste',
  'Cade Ellis','Miles Wilcox','Sebastian Rodriguez','Griffin Roeger','Dylan Strozier',
  'Christopher Melink','Holden Rasmusson','Jeffrey Taylor','Tyler Brown','Peter Broadbent',
  'Zeke Parker','Trae Moshier','Jeff Monteon','Daniel Larsen','Kris Sluyter',
  'Jason Baumsteiger','Zackary Zellmer','Christopher Kidd','Peter Klein','Alex Duffy',
  'Brinton Gottfredson','Timothy Schoenecker','Leighton Dimando','Jacob Tanner','Denver Applegate',
  'Clint Feinauer','Krista Spahich','Logan Swanson','Sam Trusty','Kaden Walker',
  'Jason Crown','Mario Torres','Lucas Burnham','Isaac Torres','Deepak Sharma',
  'Jeffrey Baumsteiger','Tanner Paepke','Sasha Dearinger','Jack Taylor','Kameron Gray',
  'Clayton Granch','Tanner Williams','Rene Silvey','Justin Gossling','Brian Malotte',
  'Cody Hayden','Firas Kassis','Collin Griffitts','Hugo Bugarini','Evan Mika',
  'Sam Jensen','Minas Trihas','Chris McHenry','Terry Xanthos','Mario Garcia',
  'Jabari Sadler','Juan Alcantar','Chase Armstrong','Jaden Banaszynski','Richard Binder',
  'Xander Davis','Elijah Emara','Joshua Fairhurst','Connor Francia','Bobby Gandhi',
  'Chase Hanley','William Hard','Gregory Howard','Mason Mahaffie','Alec Mikkelsen',
  'Kyson Moran','Joseph Niger','Ricky Niger','Rocky Niger','Braden Nitschelm',
  'Grant Ortland','Mike Pease','Joseph Snook','Vuk Vukovic','Noah Weiner',
  'Jacob Humpherys','Jarica Brown','Jacare Brown'
];

function normName(n) { return n.toLowerCase().replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim(); }
function lastName(n) { const p = normName(n).split(' '); return p[p.length-1]; }
function firstName(n) { return normName(n).split(' ')[0]; }

const VALID = new Set(['Sales Rep','Setter','Sales Rep Manager','Company Admin']);
const ALIASES = { agent:'Sales Rep', setter:'Setter', company:'Company Admin' };

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const all = [];
  for (let page = 1; page <= 100; page++) {
    const r = await fetch(`${BASE}/api/v3/users?page=${page}&pageSize=100`, { headers: { 'api-key': API_KEY } });
    const data = await r.json();
    const rows = data.results || data.data || data.users || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 100) break;
  }
  console.log('Total users fetched:', all.length);

  const matched = [];
  const unmatched = [];

  for (const name of MANAGERS) {
    const fn = firstName(name), ln = lastName(name);
    // exact first+last
    let user = all.find(u => (u.first_name||'').toLowerCase() === fn && (u.last_name||'').toLowerCase() === ln);
    // partial first (first 3 chars) + exact last
    if (!user) user = all.find(u => (u.last_name||'').toLowerCase() === ln && (u.first_name||'').toLowerCase().startsWith(fn.slice(0,4)));
    if (user) matched.push({ name, user });
    else unmatched.push(name);
  }

  console.log(`Matched: ${matched.length} | Unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log('Could not find:', unmatched.join(', '));

  console.log('\n--- Updating roles ---');
  let ok = 0, fail = 0;
  for (const { name, user } of matched) {
    const existing = (user.roles||[]).map(r => ALIASES[r.toLowerCase()] || r).filter(r => VALID.has(r));
    const need = ['Sales Rep Manager','Setter','Sales Rep'];
    const roles = [...new Set([...existing, ...need])];
    const alreadyHasAll = need.every(r => existing.includes(r));
    if (alreadyHasAll) {
      console.log(`  = ${user.email} already has all roles ${JSON.stringify(user.roles)}`);
      continue;
    }
    const res = await fetch(`${BASE}/api/v3/users`, {
      method: 'PUT', headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: user.id, roles })
    });
    const j = await res.json().catch(()=>({}));
    if (res.ok) { ok++; console.log(`  ✓ ${user.email} -> ${JSON.stringify(j.roles)}`); }
    else { fail++; console.log(`  ✗ ${user.email} ${res.status} ${JSON.stringify(j.errors||j)}`); }
    await sleep(200);
  }
  console.log(`\nDone: ${ok} updated, ${fail} failed, ${unmatched.length} not found`);
}
run().catch(console.error);
