// server.js
// Run: node server.js
// Requires: legislators-current.yaml
// Update: curl -L -o legislators-current.yaml https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml
// Deps: npm install express node-fetch@2 cors js-yaml

const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fetch = require('node-fetch'); // v2
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const LEG_FILE = path.join(__dirname, 'legislators-current.yaml');

if (!fs.existsSync(LEG_FILE)) {
  console.error(`Missing ${LEG_FILE}. Download it from the unitedstates/congress-legislators repo.`);
  process.exit(1);
}

// --- load & index legislators YAML ---
let INDEX = {}; // key = `${state}-${district}` -> normalized rep object
function normalizeName(person) {
  if (!person) return '';
  if (person.name && typeof person.name === 'object') {
    const n = person.name; return [n.first, n.middle, n.last].filter(Boolean).join(' ');
  }
  if (person.first_name || person.last_name) return [person.first_name, person.last_name].filter(Boolean).join(' ');
  return person.name || person.full_name || '';
}

function loadIndex() {
  const raw = fs.readFileSync(LEG_FILE, 'utf8');
  const docs = yaml.load(raw);
  const today = new Date();
  const map = {};

  for (const person of docs) {
    const terms = person.terms || [];
    for (const t of terms.filter(tt => tt.type === 'rep')) {
      const state = t.state;
      let districtRaw = t.district;
      if (typeof districtRaw === 'string') {
        const m = districtRaw.match(/\d+/);
        districtRaw = m ? String(parseInt(m[0],10)) : districtRaw;
      }
      let district = districtRaw ? String(districtRaw) : null;
      if (!district || district === '0' || /at[-\s]*large/i.test(String(districtRaw))) district = '1';

      const start = t.start ? new Date(t.start) : null;
      const end = t.end ? new Date(t.end) : null;
      const isCurrent = (!start || start <= today) && (!end || end >= today);
      const key = `${state}-${district}`;
      const candidate = { person, term: t, isCurrent, start: start ? start.getTime() : 0 };
      if (!map[key]) map[key] = [];
      map[key].push(candidate);
    }
  }

  const outIndex = {};
  for (const key of Object.keys(map)) {
    const arr = map[key];
    let chosen = arr.find(a => a.isCurrent);
    if (!chosen) chosen = arr.reduce((best, cur) => (cur.start > (best.start||0) ? cur : best), arr[0]);
    const p = chosen.person, t = chosen.term;
    outIndex[key] = {
      name: normalizeName(p),
      party: t.party || p.party || '',
      phone: (t.phone || p.phone || '') || '',
      url: (t.url || p.url || p.website || '') || '',
      bioguide: (p.id && p.id.bioguide) || null,
      raw_person: p,
      raw_term: t
    };
  }
  INDEX = outIndex;
  console.log(`Indexed ${Object.keys(INDEX).length} state/district entries from ${LEG_FILE}`);
}

loadIndex();

const FIPS_TO_STATE = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC",
  "12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY",
  "22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT",
  "31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH",
  "40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT",
  "50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY","72":"PR"
};

// Favicon
app.use('/img', express.static(path.join(__dirname, 'img')));
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'img', 'favicon.ico'));
});

app.use(cors());

// ---------- Frontend ----------
app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Representative Lookup (ZIP)</title>
<style>
  :root{--bg:#f6f8fb;--card:#fff;--muted:#6b7280}
  body{font-family:Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; background:var(--bg); margin:0; padding:32px; display:flex; justify-content:center}
  .container{width:100%;max-width:980px}
  .card{background:var(--card); padding:20px; border-radius:12px; box-shadow:0 8px 30px rgba(20,30,60,0.06)}
  header{display:flex;align-items:center;gap:16px;margin-bottom:12px}
  h1{font-size:20px;margin:0}
  p.lead{margin:0;color:var(--muted);font-size:13px}
  form{display:flex;gap:8px;margin-top:12px}
  input[type="text"]{flex:1;padding:10px 12px;border-radius:8px;border:1px solid #e6e9ef;font-size:15px}
  button{background:#111827;color:white;border:none;padding:10px 14px;border-radius:8px;cursor:pointer;font-weight:600}
  .results{margin-top:18px; display:grid; grid-template-columns: repeat(auto-fill,minmax(260px,1fr)); gap:12px}
  .rep{background:#fff;border-radius:10px;padding:12px;border:1px solid #f0f3f8;display:flex;gap:12px;align-items:flex-start;min-height:88px}
  .avatar{width:68px;height:90px;border-radius:6px;flex-shrink:0; background:#f3f4f6; display:flex;align-items:center;justify-content:center;overflow:hidden}
  .avatar img{width:100%;height:100%;object-fit:cover;display:block}
  .info{flex:1}
  .name{font-weight:700;margin:0;font-size:15px}
  .meta{font-size:13px;color:var(--muted);margin-top:4px}
  .actions{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}
  .btn-link{background:transparent;border:1px solid #e6e9ef;padding:7px 10px;border-radius:8px;font-size:13px;cursor:pointer;color:#111827}
  .party{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;color:white;font-weight:700}
  .party.D{background:#2563eb}
  .party.R{background:#ef4444}
  .party.I{background:#6b7280}
  .note{margin-top:10px;color:var(--muted);font-size:13px}
  .muted{color:var(--muted)}
  @media (max-width:600px){ .results{grid-template-columns:1fr} .avatar{width:56px;height:76px} }
</style>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
</head>
<body>
  <div class="container">
    <div class="card">
      <header>
        <div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#111827,#2563eb);display:flex;align-items:center;justify-content:center;color:white;font-weight:700">REP</div>
        <div>
          <h1>Find your U.S. House Representative (ZIP)</h1>
          <p class="lead">Enter a 5-digit ZIP. If the ZIP spans multiple districts, you'll see every matching representative.</p>
        </div>
      </header>

      <form id="f" onsubmit="return false;">
        <input id="zip" type="text" placeholder="ZIP (e.g. 10001)" pattern="[0-9]{5}" required />
        <button id="go">Lookup</button>
      </form>

      <div id="resultArea">
        <p class="note muted" id="hint">Enter a ZIP and press <strong>Lookup</strong>.</p>
      </div>
    </div>
  </div>

<script>
const f = document.getElementById('f');
const zipEl = document.getElementById('zip');
const resultArea = document.getElementById('resultArea');
const go = document.getElementById('go');

function partyClass(p){ if(!p) return 'I'; return (p+'').trim().startsWith('D') ? 'D' : (p+'').trim().startsWith('R') ? 'R' : 'I'; }
function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

async function renderZip(zip){
  resultArea.innerHTML = '<p class="note">Loading…</p>';
  try {
    const r = await fetch('/api/rep?zip=' + encodeURIComponent(zip));
    if (!r.ok) {
      const text = await r.text();
      resultArea.innerHTML = '<p class="note" style="color:crimson">Error: ' + r.status + ' Invalid Zip Code' + '</p>';
      return;
    }
    const j = await r.json();
    if (j.error) {
      resultArea.innerHTML = '<p class="note" style="color:crimson">Error: ' + escapeHtml(j.error) + '</p>';
      return;
    }
    const reps = j.representatives || [];
    if (reps.length === 0) {
      resultArea.innerHTML = '<p class="note">No representatives found for ZIP ' + escapeHtml(zip) + '.</p>';
      return;
    }

    // Build HTML
    const parts = [];
    parts.push('<div style="margin-top:12px"><strong>ZIP:</strong> ' + escapeHtml(zip) + (j.centroid ? (' &middot; Lat: '+j.centroid.lat+', Lon: '+j.centroid.lon) : '') + '</div>');
    if (j.districts && j.districts.length > 1) {
      parts.push('<div class="note">Multiple districts found for this ZIP — showing all matches.</div>');
    }
    parts.push('<div class="results">');
    for (const rep of reps) {
      const party = rep.party || rep.raw_term?.party || '';
      const pcls = partyClass(party);
      const bioguide = rep.bioguide || (rep.raw_person && rep.raw_person.id && rep.raw_person.id.bioguide) || null;
      const imgUrl = rep.photo;
      const website = rep.url || rep.website || (rep.raw_term && rep.raw_term.url) || '';
      const phone = rep.phone || (rep.raw_term && rep.raw_term.phone) || '';
      const state = rep.state || rep.raw_term?.state || '';
      const district = rep.district || rep.raw_term?.district || '';

      parts.push(\`
        <div class="rep" role="article">
          <div class="avatar">\${ imgUrl ? '<img src="'+imgUrl+'" alt="Photo of '+escapeHtml(rep.name)+'" onerror="this.style.display=\\'none\\'">' : '<svg width="56" height="72" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="32" rx="3" fill="#e6eefc"/><text x="50%" y="58%" font-size="9" text-anchor="middle" fill="#2563eb" font-family="system-ui,Arial" dy=".3em">NO<br>PHOTO</text></svg>' }
          </div>
          <div class="info">
            <div style="display:flex;align-items:center;gap:8px">
              <div>
                <div class="name">\${escapeHtml(rep.name || '—')}</div>
                <div class="meta">\${escapeHtml(state)} \${district ? '· CD '+escapeHtml(district) : ''}</div>
              </div>
              <div style="margin-left:auto">
                <span class="party \${pcls}">\${escapeHtml(party || 'I')}</span>
              </div>
            </div>
            <div class="actions">
              \${ phone ? '<a class="btn-link" href="tel:'+encodeURIComponent(phone)+'">☎ '+escapeHtml(phone)+'</a>' : '' }
              \${ website ? '<a class="btn-link" href="'+escapeHtml(website)+'" target="_blank">Website</a>' : '' }
              \${ rep.bioguide ? '<a class="btn-link" href="https://bioguide.congress.gov/search/bio/'+encodeURIComponent(rep.bioguide)+'" target="_blank">Bio</a>' : '' }
            </div>
          </div>
        </div>\`);
    }
    parts.push('</div>');

    resultArea.innerHTML = parts.join('');
  } catch (err) {
    console.error(err);
    resultArea.innerHTML = '<p class="note" style="color:crimson">Lookup failed — see console.</p>';
  }
}

document.getElementById('go').addEventListener('click', () => {
  const z = zipEl.value.trim();
  if (!/^[0-9]{5}$/.test(z)) {
    resultArea.innerHTML = '<p class="note" style="color:crimson">Please enter a valid 5-digit ZIP.</p>'; return;
  }
  renderZip(z);
});

// allow Enter in input
zipEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('go').click(); }
});
</script>
</body>
</html>`);
});

// ---------- API: ZIP -> centroid -> census coordinates -> districts  ----------
app.get('/api/rep', async (req, res) => {
  const zipQuery = (req.query.zip || '').trim();
  if (!zipQuery || !/^\d{5}$/.test(zipQuery)) return res.status(400).json({ error: 'zip query parameter required (5 digits)' });
  const zip = zipQuery;

  try {
    // 1) Get lat/lon for ZIP from zippopotam.us
    const zipUrl = `https://api.zippopotam.us/us/${zip}`;
    const zipResp = await fetch(zipUrl);
    if (!zipResp.ok) {
      return res.status(502).json({ error: `ZIP lookup failed: ${zipResp.status} ${zipResp.statusText}` });
    }
    const zipJson = await zipResp.json();
    const place = (zipJson.places && zipJson.places[0]) || null;
    if (!place || !place.latitude || !place.longitude) {
      return res.status(502).json({ error: 'Could not get lat/lon from ZIP service' });
    }
    const lat = parseFloat(place.latitude);
    const lon = parseFloat(place.longitude);

    // 2) Use Census geographies/coordinates with lon=x and lat=y to get districts
    const censusCoordUrl = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates'
      + `?x=${encodeURIComponent(lon)}&y=${encodeURIComponent(lat)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;

    const geoResp = await fetch(censusCoordUrl);
    if (!geoResp.ok) return res.status(502).json({ error: 'Census coordinates lookup failed: ' + geoResp.status });
    const geoJson = await geoResp.json();
    const geogs = geoJson?.result?.geographies || geoJson?.geographies || geoJson?.result;
    if (!geogs) return res.status(404).json({ error: 'Census geographies missing' });

    // find the Congressional Districts array defensively
    let cdArray = null;
    for (const key of Object.keys(geogs)) {
      if (key.toLowerCase().includes('congress')) {
        cdArray = geogs[key];
        break;
      }
    }
    if (!cdArray || cdArray.length === 0) {
      cdArray = geogs['Congressional Districts'] || geogs['Congressional District'] || geogs['CongressionalDistricts'] || geogs['Congressional district'];
    }
    if (!cdArray || cdArray.length === 0) {
      return res.status(404).json({ error: 'No Congressional Districts returned by Census for ZIP centroid' });
    }

    // Build set of keys
    const foundKeys = new Set();
    for (const cd of cdArray) {
      let districtNum = null;
      for (const k of Object.keys(cd)) {
        if (/^CD\d{1,3}$/i.test(k) && cd[k]) { districtNum = String(parseInt(cd[k], 10)); break; }
        if (k.toLowerCase().includes('name') && cd[k] && /district/i.test(cd[k])) {
          const m = String(cd[k]).match(/(\d+)\s*$/);
          if (m) { districtNum = String(parseInt(m[1],10)); break; }
        }
      }
      if (!districtNum && cd.NAME) {
        const m = String(cd.NAME).match(/(\d+)\s*$/);
        if (m) districtNum = String(parseInt(m[1],10));
      }
      const stateFipsRaw = cd.STATE || cd.STATEFP || (cd.GEOID && String(cd.GEOID).slice(0,2));
      const stateFips = stateFipsRaw ? String(stateFipsRaw).padStart(2,'0') : null;
      const state = stateFips ? (FIPS_TO_STATE[stateFips] || null) : null;
      if (!state) continue;
      if (!districtNum || districtNum === '0') districtNum = '1';
      foundKeys.add(`${state}-${districtNum}`);
    }

    if (foundKeys.size === 0) return res.status(404).json({ error: 'No congressional districts found for ZIP centroid', zip });

    // Lookup each district in local INDEX
    const reps = [];
for (const k of Array.from(foundKeys)) {
  const rep = INDEX[k];
  const [st, dnum] = k.split('-');
  if (rep) {
    // Build bioguide photoURL
    let photo = null;
    if (rep.bioguide) {
        photo = "https://bioguide.congress.gov/photo/"+rep.bioguide+".jpg";
    }

    reps.push({
      state: st,
      district: dnum,
      name: rep.name,
      party: rep.party,
      phone: rep.phone,
      url: rep.url,
      bioguide: rep.bioguide,
      photo,
      raw_person: rep.raw_person,
      raw_term: rep.raw_term
    });
  } else {
    reps.push({ state: st, district: dnum, name: null, missing: true });
  }
}

return res.json({ zip, centroid: { lat, lon }, districts: Array.from(foundKeys), representatives: reps });

  } catch (err) {
    console.error('ZIP lookup error', err);
    return res.status(500).json({ error: 'Lookup failed', details: String(err) });
  }
});

// admin reload
app.get('/admin/reload', (req, res) => {
  try { loadIndex(); res.json({ ok: true, entries: Object.keys(INDEX).length }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.listen(PORT, () => console.log(`Listening http://localhost:${PORT}`));
