
(function(){
  const VERSION = 'fresh-1.0';
  const DS = 'https://api.dexscreener.com';

  // ====== Logging & Toast ======
  const log = (...a)=>{ const el=document.getElementById('debugLog'); if(el){ try{ el.textContent += a.map(x=> typeof x==='string'? x : JSON.stringify(x)).join(' ') + '\n'; }catch(e){ el.textContent += a.join(' ') + '\n'; } } console.log(...a); };
  function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'), 1200); }

  // ====== Scoring helpers ======
  function fmtUSD(n){ if(n==null) return '—'; if(n>=1e9) return `$${(n/1e9).toFixed(2)}B`; if(n>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(n>=1e3) return `$${(n/1e3).toFixed(1)}k`; return `$${Number(n).toFixed(2)}`; }
  function norm(w){ const s=Object.values(w).reduce((a,b)=>a+b,0)||1; const o={}; for(const k in w) o[k]=w[k]/s; return o; }
  function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
  function sLiquidity(p, settings){ const liq=p?.liquidity?.usd??0, min=settings.filters.minLiquidityUSD||0; if(liq<=0) return 0; if(liq<=min) return 50*(liq/Math.max(1,min)); const extra=Math.log10((liq/(min+1)))*12; return clamp(50+extra,0,100); }
  function sVolume(p, settings){ const vol=p?.volume?.h24??0, min=settings.filters.minVolumeH24||0; if(vol<=0) return 0; if(vol<=min) return 50*(vol/Math.max(1,min)); const extra=Math.log10((vol/(min+1)))*15; return clamp(50+extra,0,100); }
  function sMomentum5m(p){ const t=(p?.txns?.m5?.buys??0)+(p?.txns?.m5?.sells??0); if(t>=100) return 100; if(t>=50) return 90; if(t>=20) return 70; if(t>=10) return 55; if(t>0) return 40; return 0; }
  function sAge(p, settings){ if(!p?.pairCreatedAt) return 30; const ageH=(Date.now()-p.pairCreatedAt)/36e5; const maxH=settings.filters.maxPairAgeHours||72; if(ageH<0.5) return 40; if(ageH<=6) return 100; if(ageH<=24) return 85; if(ageH<=maxH) return 60; return 30; }
  function sFdvFit(p, settings){ const fdv=p?.fdv, m=settings.filters.fdvMin, x=settings.filters.fdvMax; if(fdv==null) return 55; if(m != null && fdv<m) return 35; if(x != null && fdv>x) return 35; return 85; }
  function scorePair(p, settings){ const w=norm(settings.weights); const parts=[ w.liquidity*sLiquidity(p,settings), w.volumeH24*sVolume(p,settings), w.momentum5m*sMomentum5m(p), w.age*sAge(p,settings), w.fdvFit*sFdvFit(p,settings) ]; return Math.max(0, Math.min(100, Math.round(parts.reduce((a,b)=>a+b,0)))); }
  function explainScore(p, settings){ const notes=[]; const liq=p?.liquidity?.usd??0; const vol=p?.volume?.h24??0; const m5=(p?.txns?.m5?.buys??0)+(p?.txns?.m5?.sells??0); const t24=(p?.txns?.h24?.buys??0)+(p?.txns?.h24?.sells??0); const ageH=p?.pairCreatedAt? (Date.now()-p.pairCreatedAt)/36e5 : null; const fdv=p?.fdv; notes.push(`Liquidity ${fmtUSD(liq)}, Vol24 ${fmtUSD(vol)}, 5m tx ${m5}, 24h tx ${t24}`); if(ageH!=null) notes.push(`Age ${ageH.toFixed(2)}h`); const {fdvMin,fdvMax}=settings.filters; if(fdv!=null){ if(fdvMin!=null && fdv<fdvMin) notes.push(`FDV below pref (${fmtUSD(fdv)} < ${fmtUSD(fdvMin)})`); if(fdvMax!=null && fdv>fdvMax) notes.push(`FDV above pref (${fmtUSD(fdv)} > ${fmtUSD(fdvMax)})`);} return notes; }

  // ====== Presets ======
  const PRESETS = {
    spicy:{chains:['solana','base'],filters:{minLiquidityUSD:3000,minVolumeH24:2000,minTxnsH24Buys:5,minTxnsH24Sells:3,maxPairAgeHours:120,fdvMin:0,fdvMax:8000000,includeLowActivity:true},weights:{liquidity:0.2,volumeH24:0.2,momentum5m:0.35,age:0.15,fdvFit:0.1},display:{topN:30}},
    balanced:{chains:['solana','base'],filters:{minLiquidityUSD:8000,minVolumeH24:5000,minTxnsH24Buys:10,minTxnsH24Sells:5,maxPairAgeHours:72,fdvMin:100000,fdvMax:5000000,includeLowActivity:false},weights:{liquidity:0.25,volumeH24:0.25,momentum5m:0.25,age:0.15,fdvFit:0.1},display:{topN:25}},
    safe:{chains:['solana','base'],filters:{minLiquidityUSD:20000,minVolumeH24:15000,minTxnsH24Buys:25,minTxnsH24Sells:12,maxPairAgeHours:48,fdvMin:200000,fdvMax:3000000,includeLowActivity:false},weights:{liquidity:0.3,volumeH24:0.3,momentum5m:0.15,age:0.15,fdvFit:0.1},display:{topN:20}}
  };

  // ====== State & Elements ======
  let settings = loadSettings() || JSON.parse(JSON.stringify(PRESETS.balanced));
  let lastResults = [];

  const el = (id)=> document.getElementById(id);
  const chipsWrap = el('chainChips');
  const presetSel = el('presetSelect');
  const includeLow = el('includeLow');

  // ====== Wiring ======
  document.addEventListener('DOMContentLoaded', () => {
    // Buttons
    el('refreshBtn').addEventListener('click', runScan);
    el('exportBtn').addEventListener('click', exportCSV);
    el('analyzeBtn').addEventListener('click', analyzeAddress);
    el('advancedBtn').addEventListener('click', ()=> el('advancedPanel').classList.toggle('hidden'));
    el('closeAdv').addEventListener('click', ()=> el('advancedPanel').classList.add('hidden'));
    el('resetBtn').addEventListener('click', ()=> { settings = JSON.parse(JSON.stringify(PRESETS.balanced)); saveSettings(settings); applyUI(); });
    el('saveBtn').addEventListener('click', ()=> { readAdvancedIntoSettings(); saveSettings(settings); el('advancedPanel').classList.add('hidden'); toast('Saved'); });

    el('forceBtn').addEventListener('click', async () => {
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          for (const k of keys) await caches.delete(k);
        }
        localStorage.clear();
        alert('Cleared caches. Reloading…');
        location.reload(true);
      } catch (e) {
        alert('Failed to clear: ' + e);
      }
    });

    // Chain chips
    chipsWrap.querySelectorAll('.chip').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        const sel = [...chipsWrap.querySelectorAll('.chip.active')].map(x => x.dataset.chain);
        settings.chains = sel.length ? sel : [btn.dataset.chain];
        btn.classList.add('active');
        saveSettings(settings);
      });
    });

    // Preset & toggles
    presetSel.addEventListener('change', () => {
      settings = JSON.parse(JSON.stringify(PRESETS[presetSel.value]));
      saveSettings(settings);
      applyUI();
      runScan();
    });
    includeLow.addEventListener('change', () => {
      settings.filters.includeLowActivity = includeLow.checked;
      saveSettings(settings);
    });

    applyUI();
    runScan();
  });

  // ====== UI ======
  function applyUI(){
    const set = new Set(settings.chains);
    chipsWrap.querySelectorAll('.chip').forEach(ch => ch.classList.toggle('active', set.has(ch.dataset.chain)));

    // preset guess
    const sig = JSON.stringify({...settings, notifications: undefined});
    if (sig === JSON.stringify(PRESETS.spicy)) presetSel.value = 'spicy';
    else if (sig === JSON.stringify(PRESETS.safe)) presetSel.value = 'safe';
    else presetSel.value = 'balanced';

    includeLow.checked = !!settings.filters.includeLowActivity;

    setVal('minLiquidityUSD', settings.filters.minLiquidityUSD);
    setVal('minVolumeH24', settings.filters.minVolumeH24);
    setVal('minBuys24', settings.filters.minTxnsH24Buys);
    setVal('minSells24', settings.filters.minTxnsH24Sells);
    setVal('maxAgeHrs', settings.filters.maxPairAgeHours);
    setVal('fdvMin', settings.filters.fdvMin);
    setVal('fdvMax', settings.filters.fdvMax);
    setVal('topN', settings.display.topN);

    setVal('wLiq', settings.weights.liquidity);
    setVal('wVol', settings.weights.volumeH24);
    setVal('wMom', settings.weights.momentum5m);
    setVal('wAge', settings.weights.age);
    setVal('wFdv', settings.weights.fdvFit);
  }

  function readAdvancedIntoSettings(){
    settings.filters.minLiquidityUSD = getNum('minLiquidityUSD', settings.filters.minLiquidityUSD);
    settings.filters.minVolumeH24 = getNum('minVolumeH24', settings.filters.minVolumeH24);
    settings.filters.minTxnsH24Buys = getNum('minBuys24', settings.filters.minTxnsH24Buys);
    settings.filters.minTxnsH24Sells = getNum('minSells24', settings.filters.minTxnsH24Sells);
    settings.filters.maxPairAgeHours = getNum('maxAgeHrs', settings.filters.maxPairAgeHours);
    settings.filters.fdvMin = getNumMaybe('fdvMin');
    settings.filters.fdvMax = getNumMaybe('fdvMax');
    settings.display.topN = getNum('topN', settings.display.topN);

    settings.weights.liquidity = getNum('wLiq', settings.weights.liquidity);
    settings.weights.volumeH24 = getNum('wVol', settings.weights.volumeH24);
    settings.weights.momentum5m = getNum('wMom', settings.weights.momentum5m);
    settings.weights.age = getNum('wAge', settings.weights.age);
    settings.weights.fdvFit = getNum('wFdv', settings.weights.fdvFit);
  }

  // ====== Core ======
  async function runScan(){
    try{
      toast('Fetching boosted…');
      const boosted = await fetchJSON(`${DS}/token-boosts/latest/v1`);
      const chosen = boosted.filter(b => settings.chains.includes(b.chainId));
      const grouped = {};
      for (const t of chosen) (grouped[t.chainId] ??= []).push(t.tokenAddress);

      const collected = [];
      for (const [chainId, arr] of Object.entries(grouped)){
        for (let i=0; i<arr.length; i+=30){
          const slice = arr.slice(i, i+30);
          const pools = await fetchJSON(`${DS}/tokens/v1/${encodeURIComponent(chainId)}/${slice.join(',')}`);
          collected.push(...(pools || []));
        }
      }

      const filtered = collected.filter(passFilters).map(p => ({...p, _score: scorePair(p, settings), _why: explainScore(p, settings)}))
        .sort((a,b)=> (b._score-a._score) || (tx5(b)-tx5(a))).slice(0, settings.display.topN);

      lastResults = filtered;
      renderCards(filtered);
      el('lastRun').textContent = 'Last run: ' + new Date().toLocaleTimeString();
    }catch(e){
      log('runScan error:', e.message);
      toast('Error (see Debug).');
    }
  }

  async function analyzeAddress(){
    const q = el('addrInput').value.trim();
    if (!q) return;
    toast('Analyzing…');
    try{
      const res = await fetchJSON(`${DS}/latest/dex/search?q=${encodeURIComponent(q)}`);
      const pairs = Array.isArray(res?.pairs) ? res.pairs : [];
      if (!pairs.length) { toast('No data for that address'); return; }
      const best = pairs.slice().sort((a,b)=> (usd(b?.liquidity?.usd) - usd(a?.liquidity?.usd)))[0];
      const scored = { ...best, _score: scorePair(best, settings), _why: explainScore(best, settings) };
      lastResults = [scored, ...lastResults].slice(0, settings.display.topN);
      renderCards(lastResults, true);
    }catch(e){
      log('analyze error:', e.message);
      toast('Analyze failed (see Debug).');
    }
  }

  function passFilters(p){
    const f = settings.filters;
    const liq = usd(p?.liquidity?.usd);
    const vol = usd(p?.volume?.h24);
    const b24 = +(p?.txns?.h24?.buys ?? 0);
    const s24 = +(p?.txns?.h24?.sells ?? 0);
    const ageH = p?.pairCreatedAt ? (Date.now() - p.pairCreatedAt)/36e5 : 1e9;
    const fdv = +(p?.fdv ?? NaN);
    if (liq < f.minLiquidityUSD) return false;
    if (vol < f.minVolumeH24) return false;
    if (b24 < f.minTxnsH24Buys) return false;
    if (s24 < f.minTxnsH24Sells) return false;
    if (f.maxPairAgeHours && ageH > f.maxPairAgeHours) return false;
    if (!isNaN(fdv)) {
      if (f.fdvMin != null && fdv < f.fdvMin) return false;
      if (f.fdvMax != null && fdv > f.fdvMax) return false;
    }
    const t5 = tx5(p);
    if (!f.includeLowActivity && t5 < 5) return false;
    return true;
  }

  function renderCards(items, replace=false){
    const cards = el('cards');
    if (replace) cards.innerHTML = '';
    if (!items.length){ cards.innerHTML = '<div class="meta">No candidates. Tap Refresh or choose a looser preset.</div>'; return; }
    cards.innerHTML='';
    for (const p of items){
      const div = document.createElement('div');
      div.className = 'card';

      const title = `${sym(p)} • ${chain(p)} • ${dex(p)}`;
      const age = p?.pairCreatedAt ? ageStr((Date.now()-p.pairCreatedAt)/36e5) : '—';
      const liq = fmtUSD(usd(p?.liquidity?.usd));
      const fdv = fmtUSD(num(p?.fdv));
      const mc  = fmtUSD(num(p?.marketCap));
      const vol = fmtUSD(usd(p?.volume?.h24));
      const t5  = String(tx5(p));
      const t24 = String(tx24(p));
      const url = p?.url || (p?.pairAddress ? `https://dexscreener.com/${p.chainId || p.chain}/${p.pairAddress}` : '#');

      // Scanners
      const isSol = (p?.chainId || p?.chain) === 'solana';
      const baseAddr = p?.baseToken?.address || '';
      const pairAddr = p?.pairAddress || '';
      const rugLink = isSol && baseAddr ? `https://rugcheck.xyz/tokens/${baseAddr}` : (isSol && pairAddr ? `https://rugcheck.xyz/amm?lp=${pairAddr}` : null);
      const bird = isSol && baseAddr ? `https://birdeye.so/token/${baseAddr}?chain=solana` : null;
      const dexTools = isSol && pairAddr ? `https://www.dextools.io/app/en/solana/pair-explorer/${pairAddr}` : null;
      const gecko = isSol && pairAddr ? `https://www.geckoterminal.com/solana/pools/${pairAddr}` : null;

      const whyLis = (p._why || []).map(w => `<li>${escapeHtml(w)}</li>`).join('');

      div.innerHTML = `
        <div class="head">
          <strong>${escapeHtml(title)}</strong>
          <span class="badge">Score ${p._score}</span>
        </div>
        <div class="meta">Age ${age}</div>
        <div class="grid">
          <div><span class="label">Liquidity</span> ${liq}</div>
          <div><span class="label">FDV</span> ${fdv}</div>
          <div><span class="label">MC</span> ${mc}</div>
          <div><span class="label">Vol 24h</span> ${vol}</div>
          <div><span class="label">Tx 5m</span> ${t5}</div>
          <div><span class="label">Tx 24h</span> ${t24}</div>
        </div>
        <details><summary>Why?</summary><ul>${whyLis}</ul></details>
        <div class="linkrow">
          <a class="btn" href="${url}" target="_blank" rel="noopener">DexScreener</a>
          ${rugLink ? `<a class="btn" href="${rugLink}" target="_blank" rel="noopener">RugCheck</a>` : ''}
          ${bird ? `<a class="btn" href="${bird}" target="_blank" rel="noopener">Birdeye</a>` : ''}
          ${dexTools ? `<a class="btn" href="${dexTools}" target="_blank" rel="noopener">DexTools</a>` : ''}
          ${gecko ? `<a class="btn" href="${gecko}" target="_blank" rel="noopener">GeckoTerminal</a>` : ''}
        </div>`;
      cards.appendChild(div);
    }
  }

  // ====== Export CSV ======
  function exportCSV(){
    if (!lastResults.length){ toast('Nothing to export'); return; }
    const headers = ['score','chain','dex','base_symbol','base_address','quote_symbol','quote_address','liquidity_usd','fdv','marketcap','volume_24h','tx_5m','tx_24h','pair_age_h','pair_url'];
    const rows = [headers];
    for (const p of lastResults){
      rows.push([
        p._score,
        chain(p),
        dex(p),
        safe(p?.baseToken?.symbol),
        safe(p?.baseToken?.address),
        safe(p?.quoteToken?.symbol),
        safe(p?.quoteToken?.address),
        usd(p?.liquidity?.usd),
        num(p?.fdv),
        num(p?.marketCap),
        usd(p?.volume?.h24),
        tx5(p),
        tx24(p),
        p?.pairCreatedAt ? ((Date.now()-p.pairCreatedAt)/36e5).toFixed(2) : '',
        p?.url || (p?.pairAddress ? `https://dexscreener.com/${p.chainId || p.chain}/${p.pairAddress}` : '')
      ]);
    }
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }));
    a.download = 'memefinder.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ====== Utils ======
  function fetchJSON(url){ return fetch(url, { cache:'no-store' }).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).catch(e=>{ log('fetchJSON error', url, e.message); throw e; }); }
  function loadSettings(){ try{ const raw=localStorage.getItem('memefinder-fresh'); return raw? JSON.parse(raw): null; }catch{ return null; } }
  function saveSettings(s){ localStorage.setItem('memefinder-fresh', JSON.stringify(s)); }
  function setVal(id,v){ const el=document.getElementById(id); if(el) el.value = (v ?? ''); }
  function getNum(id,d=0){ const v=parseFloat(document.getElementById(id).value); return isNaN(v)? d: v; }
  function getNumMaybe(id){ const el=document.getElementById(id); if(!el.value) return null; const v=parseFloat(el.value); return isNaN(v)? null: v; }
  function usd(x){ const n=Number(x); return isNaN(n)? 0: n; }
  function num(x){ const n=Number(x); return isNaN(n)? 0: n; }
  function tx5(p){ return (p?.txns?.m5?.buys ?? 0) + (p?.txns?.m5?.sells ?? 0); }
  function tx24(p){ return (p?.txns?.h24?.buys ?? 0) + (p?.txns?.h24?.sells ?? 0); }
  function chain(p){ return (p?.chainId || p?.chain || '').toUpperCase(); }
  function dex(p){ return p?.dexId || ''; }
  function sym(p){ return `${p?.baseToken?.symbol || '?'} / ${p?.quoteToken?.symbol || '?'}`; }
  function ageStr(h){ if (h<1) return Math.max(1, Math.floor(h*60)) + 'm'; return h.toFixed(1)+'h'; }
  function safe(x){ return (x==null?'':String(x)); }
  function csvEscape(x){ const s = String(x==null?'':x); if (/[\",\n]/.test(s)) return '\"' + s.replace(/\"/g,'\"\"') + '\"'; return s; }
  function escapeHtml(s){ return String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[m])); }

  // Global error capture
  window.addEventListener('error', (e) => { toast('JS error: ' + (e?.message || e.toString())); log('window error', e?.message || e); });

  // Expose for debugging
  window._memefinder = { VERSION, settings, runScan, analyzeAddress };
})();