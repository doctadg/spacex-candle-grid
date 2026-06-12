(() => {
  const COIN = 'xyz:SPCX';
  const DEX = 'xyz';
  const API = 'https://api.hyperliquid.xyz/info';
  const WS_URL = 'wss://api.hyperliquid.xyz/ws';
  const ROWS = 8;
  const COLS = 5;
  const IPO_REFERENCE = 135;
  const LOCK_SECONDS = 5;
  const STALE_MS = 15_000;

  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');
  const chart = $('#chart');
  const ctx = chart.getContext('2d');
  const playerNames = ['Nova', 'Vex', 'Atlas', 'Mako', 'Ion', 'Rook', 'Luna', 'Drift', 'Astra', 'Vector'];
  const chipColors = ['#7c5cff', '#9f8cff', '#57a2ff', '#1fd99d', '#f0b45f'];

  let candles = [];
  let trace = [];
  let price = 0;
  let open = 0;
  let roundStart = 0;
  let roundEnd = 0;
  let timeLeft = 0;
  let selected = null;
  let locked = null;
  let score = 12400;
  let streak = 2;
  let tape = [];
  let settling = false;
  let ws = null;
  let reconnectTimer = null;
  let last = performance.now();
  let lastFeed = 0;
  let lastWsMessage = 0;
  let lastBandRender = 0;
  let assetCtx = {};
  let book = { bid: null, ask: null, spread: null };

  const money = (n, decimals = 2) => Number.isFinite(n) ? '$' + n.toFixed(decimals) : '—';
  const compact = (n) => {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
    return String(Math.round(n));
  };
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pct = (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  async function postInfo(payload) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Hyperliquid ${payload.type} ${res.status}`);
    return res.json();
  }

  function parseCandle(c) {
    return {
      t: Number(c.t),
      T: Number(c.T),
      s: c.s,
      i: c.i,
      open: Number(c.o),
      close: Number(c.c),
      high: Number(c.h),
      low: Number(c.l),
      volume: Number(c.v || 0),
      trades: Number(c.n || 0),
    };
  }

  function formatRound(ts = roundStart) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function seedFallback() {
    candles = [];
    let p = 163;
    const now = Date.now();
    const start = Math.floor((now - 70 * 60_000) / 60_000) * 60_000;
    for (let i = 0; i < 70; i++) {
      const o = p;
      const c = clamp(o + Math.sin(i / 4) * .22 + rand(-.55, .6), 145, 185);
      candles.push({ t: start + i * 60_000, T: start + (i + 1) * 60_000 - 1, open: o, close: c, high: Math.max(o, c) + rand(.08, .75), low: Math.min(o, c) - rand(.08, .7), volume: rand(20000, 90000), trades: Math.round(rand(200, 1500)) });
      p = c;
    }
    const current = candles.at(-1);
    price = current.close;
    open = current.open;
    roundStart = current.t;
    roundEnd = current.T;
    trace = candles.slice(-46).map(c => c.close);
  }

  async function loadInitialFeed() {
    const end = Date.now();
    const start = end - 95 * 60_000;
    const [rawCandles, metaCtx, mids] = await Promise.all([
      postInfo({ type: 'candleSnapshot', req: { coin: COIN, interval: '1m', startTime: start, endTime: end }, dex: DEX }),
      postInfo({ type: 'metaAndAssetCtxs', dex: DEX }),
      postInfo({ type: 'allMids', dex: DEX }),
    ]);

    candles = rawCandles.map(parseCandle).filter(c => Number.isFinite(c.close));
    if (candles.length < 2) throw new Error('No SPCX candles returned from Hyperliquid');

    const [meta, ctxs] = metaCtx;
    const idx = meta.universe.findIndex((u) => u.name === COIN);
    if (idx >= 0) assetCtx = ctxs[idx] || {};

    const lastCandle = candles.at(-1);
    const mid = num(mids[COIN]);
    price = num(assetCtx.markPx) ?? num(assetCtx.midPx) ?? mid ?? lastCandle.close;
    open = lastCandle.open;
    roundStart = lastCandle.t;
    roundEnd = lastCandle.T;
    trace = candles.slice(-60).map(c => c.close);
    lastWsMessage = Date.now();

    tape = candles.slice(-6, -1).reverse().map((c) => ({
      round: formatRound(c.t),
      band: 'R' + (bandFor(c.close) + 1),
      close: c.close,
      score: c.close >= c.open ? '+' + compact(Math.abs(c.close - c.open) * 1000) : '-' + compact(Math.abs(c.close - c.open) * 1000),
    }));
  }

  function range() {
    const all = candles.flatMap(c => [c.high, c.low, c.close]).concat(trace, price).filter(Number.isFinite);
    if (!all.length) return { min: 150, max: 175 };
    const hi = Math.max(...all);
    const lo = Math.min(...all);
    const pad = Math.max(.85, (hi - lo) * .18);
    return { min: lo - pad, max: hi + pad };
  }

  function bands() {
    const r = range();
    const step = (r.max - r.min) / ROWS;
    return Array.from({ length: ROWS }, (_, row) => {
      const top = r.max - row * step;
      const bottom = top - step;
      return { top, bottom, label: `${money(bottom)}–${money(top)}` };
    });
  }

  function bandFor(p) {
    const b = bands();
    const idx = b.findIndex(x => p <= x.top && p >= x.bottom);
    return clamp(idx === -1 ? ROWS - 1 : idx, 0, ROWS - 1);
  }

  function mult(row, col) {
    const distance = Math.abs(row - (ROWS - 1) / 2);
    return +(1.16 + col * .28 + distance * .15).toFixed(2);
  }

  function odds(row) {
    const distance = Math.abs(row - (ROWS - 1) / 2);
    return Math.max(9, Math.round(28 - distance * 4)) + '%';
  }

  function buildGrid() {
    grid.innerHTML = '';
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const btn = document.createElement('button');
        btn.className = 'cell';
        btn.type = 'button';
        btn.dataset.row = row;
        btn.dataset.col = col;
        btn.style.setProperty('--heat', (0.018 + (ROWS - row) * .003 + col * .005).toFixed(3));
        btn.textContent = col === COLS - 1 ? 'CLOSE' : `${mult(row, col).toFixed(2)}x`;
        btn.setAttribute('aria-label', `Select row ${row + 1}, lane ${col + 1}`);
        btn.addEventListener('click', () => choose(row, col));
        grid.appendChild(btn);
      }
    }
    addOccupants();
    renderBands(true);
  }

  function renderBands(force = false) {
    const now = performance.now();
    if (!force && now - lastBandRender < 700) return;
    lastBandRender = now;
    $('#priceRail').innerHTML = bands().map(b => `<div class="band-label">${b.label}</div>`).join('');
  }

  function addOccupants() {
    const cells = Array.from(grid.children);
    cells.forEach(c => c.querySelectorAll('.occupant').forEach(o => o.remove()));
    for (let i = 0; i < 26; i++) {
      const row = clamp(Math.floor(rand(0, ROWS)), 0, ROWS - 1);
      const col = clamp(Math.floor(rand(0, COLS)), 0, COLS - 1);
      const dot = document.createElement('span');
      dot.className = 'occupant';
      dot.style.setProperty('--x', rand(7, 22).toFixed(0) + 'px');
      dot.style.setProperty('--y', rand(7, 22).toFixed(0) + 'px');
      dot.style.setProperty('--c', chipColors[Math.floor(rand(0, chipColors.length))]);
      cells[row * COLS + col]?.appendChild(dot);
    }
  }

  function choose(row, col) {
    if (settling || locked || timeLeft <= LOCK_SECONDS) {
      toast('Grid is locked for this candle. Next round opens after settlement.');
      return;
    }
    selected = { row, col };
    Array.from(grid.children).forEach(c => c.classList.remove('selected'));
    grid.children[row * COLS + col].classList.add('selected');
    updateTicket();
    $('#lockBtn').disabled = false;
  }

  function updateTicket() {
    if (!selected) return;
    const b = bands()[selected.row];
    const m = mult(selected.row, selected.col);
    const stake = Number($('#stake').value || 0);
    $('#pickTitle').textContent = `Row ${selected.row + 1} · Lane ${selected.col + 1}`;
    $('#pickDetail').textContent = `SPCX close must land between ${b.label.replace('–', ' and ')}.`;
    $('#pickBand').textContent = b.label;
    $('#pickLane').textContent = selected.col === COLS - 1 ? 'Close lane' : `Lane ${selected.col + 1}`;
    $('#pickMult').textContent = m.toFixed(2) + 'x';
    $('#pickOdds').textContent = odds(selected.row);
    $('#potential').textContent = compact(stake * m * (1 + streak * .05)) + ' pts';
  }

  function lockPick() {
    if (!selected) return toast('Select a square first.');
    if (timeLeft <= LOCK_SECONDS) return toast('Lock window already closed.');
    locked = { ...selected, stake: Number($('#stake').value || 0) };
    $('#lockBtn').disabled = true;
    grid.querySelectorAll('.cell').forEach(c => c.classList.add('locked'));
    feed('You', `locked Row ${locked.row + 1} / Lane ${locked.col + 1}`);
    toast('Ticket locked on live SPCX candle.');
  }

  function feed(who, action) {
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerHTML = `<small>${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</small><b>${who}</b> <em>${action}</em>`;
    $('#feed').prepend(item);
    while ($('#feed').children.length > 8) $('#feed').lastElementChild.remove();
  }

  function renderLeaders() {
    const rows = [
      ['VX', 'Vex', 'Opening sniper', 38920],
      ['DK', 'DriftKing', '5-round ROI', 35110],
      ['IO', 'Ion', 'Band discipline', 28840],
      ['YOU', 'You', `${streak}x streak`, score],
      ['NV', 'Nova', 'Close hunter', 10740]
    ].sort((a, b) => b[3] - a[3]);
    $('#leaders').innerHTML = rows.map((r, i) => `<div class="leader"><div class="avatar">${r[0]}</div><div><b>${i + 1}. ${r[1]}</b><small>${r[2]}</small></div><strong>${compact(r[3])}</strong></div>`).join('');
  }

  function renderTape() {
    $('#roundTape').innerHTML = tape.slice(0, 5).map(t => `<div class="tape-item"><small>${t.round} · ${t.band}</small><strong>${money(t.close)}</strong><span class="${String(t.score).startsWith('+') ? 'positive' : 'negative'}">${t.score} pts</span></div>`).join('');
  }

  function resize() {
    const rect = chart.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (chart.width !== w || chart.height !== h) {
      chart.width = w;
      chart.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: rect.width, h: rect.height };
  }

  function draw() {
    const { w, h } = resize();
    const pad = { l: 44, r: 30, t: 38, b: 42 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const r = range();
    const y = (p) => pad.t + (r.max - p) / (r.max - r.min) * plotH;
    const x = (i, total = candles.length + 8) => pad.l + i / total * plotW;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);

    const gridX = pad.l + plotW * .56;
    ctx.fillStyle = 'rgba(124,92,255,.035)';
    ctx.fillRect(gridX, pad.t, w - gridX - pad.r, plotH);

    for (let i = 0; i <= 8; i++) {
      const yy = pad.t + i / 8 * plotH;
      ctx.strokeStyle = i === 4 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.052)';
      ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const xx = pad.l + i / 10 * plotW;
      ctx.strokeStyle = 'rgba(255,255,255,.04)';
      ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, h - pad.b); ctx.stroke();
    }

    candles.slice(-72).forEach((c, i, arr) => {
      const xx = x(i, arr.length + 8);
      const width = Math.max(3, plotW / 100);
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? 'rgba(31,217,157,.78)' : 'rgba(255,90,116,.72)';
      ctx.fillStyle = up ? 'rgba(31,217,157,.62)' : 'rgba(255,90,116,.58)';
      ctx.beginPath(); ctx.moveTo(xx, y(c.high)); ctx.lineTo(xx, y(c.low)); ctx.stroke();
      const top = Math.min(y(c.open), y(c.close));
      const bottom = Math.max(y(c.open), y(c.close));
      ctx.fillRect(xx - width / 2, top, width, Math.max(2, bottom - top));
    });

    const startX = pad.l + plotW * .70;
    const endX = w - pad.r - 12;
    if (trace.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,.42)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      trace.slice(-90).forEach((p, i, arr) => {
        const xx = startX + i / Math.max(1, arr.length - 1) * (endX - startX);
        const yy = y(p);
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      });
      ctx.stroke();
    }

    const refY = y(IPO_REFERENCE);
    if (refY >= pad.t && refY <= h - pad.b) {
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(240,180,95,.56)';
      ctx.beginPath(); ctx.moveTo(pad.l, refY); ctx.lineTo(w - pad.r, refY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(201,206,218,.66)';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillText('IPO REF 135.00', pad.l, refY - 8);
    }

    const dotX = endX;
    const dotY = y(price);
    const up = price >= open;
    ctx.fillStyle = up ? '#1fd99d' : '#ff5a74';
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(244,246,251,.9)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(money(price), w - pad.r, dotY - 9);
    ctx.textAlign = 'left';
  }

  function integrateCandle(raw) {
    const c = parseCandle(raw);
    if (!Number.isFinite(c.close)) return;
    const lastCandle = candles.at(-1);

    if (!lastCandle || c.t > lastCandle.t) {
      if (lastCandle && !settling && roundEnd && Date.now() >= roundEnd - 750) {
        settle(lastCandle.close, lastCandle);
      }
      candles.push(c);
      if (candles.length > 100) candles.shift();
      if (settling) {
        setTimeout(() => resetLiveRound(c), 1900);
      } else {
        resetLiveRound(c, { silent: true, keepSelection: true });
      }
    } else if (c.t === lastCandle.t) {
      candles[candles.length - 1] = c;
      open = c.open;
      roundStart = c.t;
      roundEnd = c.T;
    }

    price = num(assetCtx.markPx) ?? c.close;
    trace.push(price);
    if (trace.length > 120) trace.shift();
  }

  function settle(closePrice = price, candle = candles.at(-1)) {
    if (settling) return;
    settling = true;
    timeLeft = 0;
    const row = bandFor(closePrice);
    const lane = COLS - 1;
    const winCell = grid.children[row * COLS + lane];
    grid.querySelectorAll('.cell').forEach(c => c.classList.remove('winner'));
    winCell?.classList.add('winner');

    const b = bands()[row];
    const mid = (b.top + b.bottom) / 2;
    const r = range();
    const yPct = (r.max - mid) / (r.max - r.min) * 100;
    $('#settlementLine').style.top = yPct + '%';
    $('#settlementLine').classList.add('show');

    let title = 'Missed band';
    let scoreDelta = '0';
    let text = `SPCX closed ${money(closePrice)} in Row ${row + 1}.`;
    if (locked && locked.row === row) {
      const gain = Math.round(locked.stake * mult(locked.row, locked.col) * (1 + streak * .05));
      score += gain;
      streak += 1;
      title = '+' + compact(gain);
      scoreDelta = title;
      text = `Hyperliquid ${COIN} closed ${money(closePrice)} in Row ${row + 1}. Your ticket paid with a ${streak}x streak.`;
    } else {
      if (locked) {
        score = Math.max(0, score - locked.stake);
        scoreDelta = '-' + compact(locked.stake);
      }
      streak = 0;
    }

    tape.unshift({ round: formatRound(candle?.t || roundStart), band: 'R' + (row + 1), close: closePrice, score: scoreDelta });
    renderTape();
    renderLeaders();
    $('#settleTitle').textContent = title;
    $('#settleText').textContent = text;
    $('#settlement').classList.add('show');
  }

  function resetLiveRound(candle = candles.at(-1), opts = {}) {
    if (!candle) return;
    settling = false;
    selected = opts.keepSelection ? selected : null;
    locked = null;
    open = candle.open;
    roundStart = candle.t;
    roundEnd = candle.T;
    $('#settlement').classList.remove('show');
    $('#settlementLine').classList.remove('show');
    $('#lockBtn').disabled = true;
    if (!opts.keepSelection) {
      $('#pickTitle').textContent = 'No square selected';
      $('#pickDetail').textContent = 'Choose a band on the chart grid to price the ticket.';
      ['pickBand','pickLane','pickMult','pickOdds','potential'].forEach(id => $('#' + id).textContent = '—');
    }
    buildGrid();
    if (!opts.silent) feed('Hyperliquid', `new ${COIN} candle ${formatRound(candle.t)}`);
  }

  function connectWs() {
    clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(WS_URL);

    ws.addEventListener('open', () => {
      lastWsMessage = Date.now();
      feed('Hyperliquid', `connected to ${COIN}`);
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: COIN } }));
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: COIN } }));
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: COIN, interval: '1m' } }));
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: COIN } }));
    });

    ws.addEventListener('message', (ev) => {
      lastWsMessage = Date.now();
      const msg = JSON.parse(ev.data);
      if (msg.channel === 'trades') handleTrades(msg.data || []);
      if (msg.channel === 'l2Book') handleBook(msg.data);
      if (msg.channel === 'activeAssetCtx') handleAssetCtx(msg.data?.ctx);
      if (msg.channel === 'candle') integrateCandle(msg.data);
    });

    ws.addEventListener('close', () => {
      reconnectTimer = setTimeout(connectWs, 2000);
    });

    ws.addEventListener('error', () => {
      try { ws.close(); } catch (_) {}
    });
  }

  function handleTrades(trades) {
    if (!Array.isArray(trades) || trades.length === 0) return;
    for (const tr of trades.slice(-12)) {
      const px = num(tr.px);
      if (!px) continue;
      price = px;
      trace.push(px);
      if (trace.length > 120) trace.shift();
      const lastCandle = candles.at(-1);
      if (lastCandle && tr.time >= lastCandle.t && tr.time <= lastCandle.T) {
        lastCandle.close = px;
        lastCandle.high = Math.max(lastCandle.high, px);
        lastCandle.low = Math.min(lastCandle.low, px);
        lastCandle.volume += Number(tr.sz || 0);
      }
    }

    const now = Date.now();
    if (now - lastFeed > 2600) {
      lastFeed = now;
      const tr = trades.at(-1);
      const side = tr.side === 'B' ? 'buy' : 'sell';
      feed(playerNames[Math.floor(rand(0, playerNames.length))], `${side} ${Number(tr.sz || 0).toFixed(2)} @ ${money(Number(tr.px || price))}`);
    }
  }

  function handleBook(data) {
    if (!data?.levels?.length) return;
    const bid = num(data.levels[0]?.[0]?.px);
    const ask = num(data.levels[1]?.[0]?.px);
    book = { bid, ask, spread: bid && ask ? ask - bid : null };
    if (bid && ask && !assetCtx.markPx) price = (bid + ask) / 2;
  }

  function handleAssetCtx(ctxData) {
    if (!ctxData) return;
    assetCtx = ctxData;
    price = num(assetCtx.markPx) ?? num(assetCtx.midPx) ?? price;
    if (Number.isFinite(price)) {
      trace.push(price);
      if (trace.length > 120) trace.shift();
    }
  }

  function hud() {
    const lastCandle = candles.at(-1);
    if (lastCandle) {
      roundStart = lastCandle.t;
      roundEnd = lastCandle.T;
      open = lastCandle.open;
    }
    timeLeft = roundEnd ? Math.max(0, (roundEnd - Date.now()) / 1000) : 0;
    if (!settling && roundEnd && Date.now() >= roundEnd) settle(price, lastCandle);

    const move = open ? (price / open - 1) * 100 : 0;
    $('#lastPrice').textContent = money(price);
    $('#moveLabel').textContent = pct(move);
    $('#moveLabel').className = move >= 0 ? 'positive' : 'negative';
    $('#roundOpen').textContent = money(open);
    $('#rangeLabel').textContent = `${money(num(assetCtx.markPx) ?? price)} / ${money(num(assetCtx.oraclePx))}`;
    $('#lockedPicks').textContent = compact(assetCtx.openInterest);
    $('#poolLabel').textContent = compact(assetCtx.dayNtlVlm);
    $('#scoreLabel').textContent = compact(score) + ' pts';
    $('#heroMark').textContent = money(num(assetCtx.markPx) ?? price);
    $('#heroOi').textContent = compact(assetCtx.openInterest);
    $('#heroVol').textContent = compact(assetCtx.dayNtlVlm);
    $('#railPlayers').textContent = Date.now() - lastWsMessage < STALE_MS ? 'Live' : 'Stale';
    $('#railRound').textContent = formatRound(roundStart);
    $('#railState').textContent = timeLeft <= LOCK_SECONDS ? 'Locked' : locked ? 'Ticket in' : 'Open';
    $('#lockState').textContent = timeLeft <= LOCK_SECONDS ? 'Closed' : locked ? 'Locked' : 'Open';
    const secs = Math.max(0, Math.ceil(timeLeft));
    $('#timer').textContent = '00:' + String(secs).padStart(2, '0');
    $('#railProgress').style.transform = `scaleX(${Math.max(0, timeLeft / 60)})`;
    grid.querySelectorAll('.cell').forEach(c => c.classList.toggle('locked', timeLeft <= LOCK_SECONDS || !!locked));
    if (selected && !locked) updateTicket();
    renderBands(false);
  }

  function loop(now) {
    const dt = Math.min(.08, (now - last) / 1000);
    last = now;
    hud(dt);
    draw();
    requestAnimationFrame(loop);
  }

  async function boot() {
    try {
      await loadInitialFeed();
      feed('Hyperliquid', `loaded ${COIN} candles`);
    } catch (err) {
      console.warn(err);
      seedFallback();
      feed('Fallback', 'using local sample until Hyperliquid reconnects');
      toast('Hyperliquid initial load failed; retrying live websocket.');
    }
    buildGrid();
    renderTape();
    renderLeaders();
    $('#stake').addEventListener('input', updateTicket);
    $('#lockBtn').addEventListener('click', lockPick);
    $('#nextRound').addEventListener('click', () => resetLiveRound(candles.at(-1)));
    window.addEventListener('resize', draw);
    connectWs();
    requestAnimationFrame(loop);
  }

  boot();
})();
