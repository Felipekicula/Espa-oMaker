// Teste OPCIONAL de ponta a ponta contra um Supabase de HOMOLOGAÇÃO (banco real, dados fictícios).
// Não faz parte de `npm test`. Preparação e uso: docs/HOMOLOGACAO.md.
//
//   npm run test:homolog                        roda todos os cenários e limpa o que criou
//   npm run test:homolog -- --preparar-vencido  deixa um bloco vencido pronto para avaliar à mão
//   npm run test:homolog -- --restaurar         desfaz o que uma execução anterior deixou
//
// Credenciais: HOMOLOG_EMAIL e HOMOLOG_SENHA no .env.local (ignorado pelo Git). A senha nunca é
// impressa e, sem o prefixo VITE_, não entra no site.
//
// Antes de QUALQUER gravação confere que o destino é a homologação e para se não for:
//   1. o login é de um usuário fictício (@example.com);
//   2. a URL do .env.local é diferente da usada pelo site de produção;
//   3. todos os usuários do banco são fictícios (nome terminado em "Teste");
//   4. todas as demandas têm título de dado fictício.
// Grava só pelas mesmas operações da tela, sem desligar nenhuma regra do banco, e apaga apenas os
// registros que ele próprio criou (guardados por id; os títulos começam com "AUTO ").
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '..')
const PROD_SITE = process.env.HOMOLOG_PROD_SITE || 'https://espa-o-maker.vercel.app'
const FICTICIOS = /^(Rover de teste|Demanda ficticia|Entrega ficticia|Entrega antiga sem data)/
const TZ = 'America/Sao_Paulo'
const mode = process.argv.includes('--preparar-vencido') ? 'preparar' : process.argv.includes('--restaurar') ? 'restaurar' : 'completo'
const shots = path.join(os.tmpdir(), 'ctp-homolog-capturas'); fs.mkdirSync(shots, { recursive: true })
const stateFile = path.join(os.tmpdir(), 'ctp-homolog-estado.json')

const envFile = path.join(repo, '.env.local')
const env = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {}
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY, EMAIL = env.HOMOLOG_EMAIL, SENHA = env.HOMOLOG_SENHA
const results = []
const record = (cenario, ok, detalhe = '') => { results.push({ cenario, ok }); console.log(`${ok === null ? '?' : ok ? '✔' : '✖'} ${cenario}${detalhe ? ' — ' + detalhe : ''}`) }
const stop = message => { console.error('\nPARADO, nada foi gravado: ' + message); process.exit(2) }
const run = Math.random().toString(16).slice(2, 6) // distingue os registros desta execução
const hhmm = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

;(async () => {
  // ---------- conferência do destino (somente leitura) ----------
  if (!URL_ || !KEY) stop('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes no .env.local.')
  if (!EMAIL || !SENHA) stop('preencha HOMOLOG_EMAIL e HOMOLOG_SENHA no .env.local (veja docs/HOMOLOGACAO.md).')
  if (!/@example\.com$/.test(EMAIL)) stop('HOMOLOG_EMAIL precisa ser de um usuário fictício (@example.com).')
  if (KEY.startsWith('sb_secret_') || /service_role/.test(Buffer.from(KEY.split('.')[1] || '', 'base64url').toString())) stop('a chave do .env.local é secreta; use a chave pública.')
  const prodUrls = new Set()
  try {
    const html = await (await fetch(PROD_SITE)).text()
    for (const m of html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)) for (const x of (await (await fetch(PROD_SITE + m[1])).text()).matchAll(/https:\/\/[a-z0-9]{15,30}\.supabase\.co/g)) prodUrls.add(x[0])
  } catch (e) { stop('não consegui ler o site de produção para comparar a URL do banco (' + e.message + ').') }
  if (!prodUrls.size) stop('não encontrei a URL do banco de produção para comparar.')
  if (prodUrls.has(URL_)) stop('a URL do .env.local é a do banco de PRODUÇÃO.')

  const login = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: SENHA }) })
  const session = await login.json()
  if (!login.ok || !session.access_token) stop('login recusado: ' + (session.msg || session.error_description || session.message || login.status) + '. Confira HOMOLOG_SENHA.')
  const rest = async (method, pathAndQuery, body, prefer) => {
    const r = await fetch(URL_ + '/rest/v1/' + pathAndQuery, { method, headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: r.ok, status: r.status, data, message: data && data.message }
  }
  const must = async (...args) => { const r = await rest(...args); if (!r.ok) throw new Error(`${args[0]} ${args[1].split('?')[0]}: ${r.message || r.status}`); return r.data }

  const people = await must('GET', 'app_users?select=id,name&order=name')
  if (people.length < 2 || people.some(p => !/Teste$/.test(p.name))) stop('há usuários que não são fictícios (nome sem "Teste" no final), ou menos de dois usuários.')
  const allTickets = []
  for (let offset = 0; ; offset += 1000) { const page = await must('GET', `tickets?select=id,titulo,status,responsavel_id,entregue_em&order=id&offset=${offset}&limit=1000`); allTickets.push(...page); if (page.length < 1000) break }
  const strangers = allTickets.filter(t => !FICTICIOS.test(t.titulo))
  if (!allTickets.length || strangers.length) stop(`há ${strangers.length} demanda(s) que não são dados fictícios (de ${allTickets.length}). Este teste só roda na homologação.`)
  const me = people.find(p => p.id === session.user.id); if (!me) stop('o usuário do login não está em app_users.')
  const target = people.find(p => p.id !== me.id) // a agenda usada no teste é a de outra pessoa, não a de quem faz login
  const openTicket = allTickets.find(t => t.titulo === 'Rover de teste') || allTickets.find(t => !['entregue', 'cancelada'].includes(t.status))
  if (!openTicket) stop('não há demanda fictícia em aberto para vincular uma etapa.')
  console.log(`Destino conferido: URL diferente da produção; ${people.length} usuários e ${allTickets.length} demandas, todos fictícios.`)
  console.log(`Login: ${me.name}. Agenda usada: ${target.name}.\n`)

  // ---------- registro do que esta ferramenta cria, para limpar só isso ----------
  let state = { url: URL_, items: [], events: [], timeOff: [], availability: null }
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
  const setAvailability = (personId, rows) => must('POST', 'rpc/maker_save_availability', { person_id: personId, slots: rows.map(({ weekday, period, starts_at, ends_at }) => ({ weekday, period, starts_at, ends_at })) })
  const undo = async s => {
    if (s.availability) await setAvailability(s.availability.userId, s.availability.rows)
    if (s.timeOff && s.timeOff.length) await must('DELETE', `maker_time_off?id=in.(${s.timeOff.join(',')})`)
    if (s.items.length) { await must('DELETE', `maker_blocks?work_item_id=in.(${s.items.join(',')})`); await must('DELETE', `maker_work_items?id=in.(${s.items.join(',')})`) }
    if (s.events.length) {
      const prep = await must('GET', `maker_work_items?select=id&event_id=in.(${s.events.join(',')})&title=like.AUTO%20*`)
      if (prep.length) { await must('DELETE', `maker_blocks?work_item_id=in.(${prep.map(i => i.id).join(',')})`); await must('DELETE', `maker_work_items?id=in.(${prep.map(i => i.id).join(',')})`) }
      await must('DELETE', `maker_events?id=in.(${s.events.join(',')})`)
    }
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile)
  }
  if (fs.existsSync(stateFile)) {
    const previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (previous.url !== URL_) stop('há um estado salvo de outro banco em ' + stateFile + '. Apague o arquivo se ele não for mais necessário.')
    await undo(previous); console.log('Execução anterior desfeita (horários restaurados e registros "AUTO" dela removidos).')
  }
  if (mode === 'restaurar') { console.log('Nada mais a restaurar.'); return }
  const leftovers = [...await must('GET', 'maker_work_items?select=title&title=like.AUTO%20*'), ...await must('GET', 'maker_events?select=title&title=like.AUTO%20*')]
  if (leftovers.length) stop(`existem ${leftovers.length} registro(s) "AUTO" que não foram criados por esta máquina (${leftovers.slice(0, 3).map(l => l.title).join(', ')}…). Não apago o que não criei; remova-os ou renomeie antes de rodar.`)

  const nowParts = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]))
    return { day: `${parts.year}-${parts.month}-${parts.day}`, clock: Number(parts.hour) * 60 + Number(parts.minute) }
  }
  const today = nowParts().day
  const plus = (n, from = today) => { const d = new Date(from + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const isodow = day => ((new Date(day + 'T12:00Z').getUTCDay() + 6) % 7) + 1
  const br = day => day.split('-').reverse().join('/')
  const original = await must('GET', `maker_availability?select=weekday,period,starts_at,ends_at&user_id=eq.${target.id}`)
  const newItems = async rows => { const made = await must('POST', 'maker_work_items', rows, 'return=representation'); state.items.push(...made.map(i => i.id)); save(); return made }
  const blocksOf = itemId => must('GET', `maker_blocks?select=*&work_item_id=eq.${itemId}&order=created_at`)

  /**
   * Bloco vencido sem contornar o banco: reserva um bloco para HOJE enquanto o período está aberto
   * (o banco valida a capacidade normalmente) e depois encurta o horário de trabalho desse período
   * para terminar agora. A tela passa a tratar o bloco como não concluído, igual a um período que acabou.
   */
  async function makeOverdue(baseRows, title, source) {
    const { clock } = nowParts(), weekday = isodow(today)
    if (weekday > 5) return { skip: 'hoje é fim de semana; blocos só existem de segunda a sexta' }
    const period = clock < 720 ? 'manha' : 'tarde', end = period === 'manha' ? 720 : 1439
    const minutes = Math.min(60, end - clock - 3)
    if (minutes < 1) return { skip: 'faltam menos de 5 minutos para o fim do período; rode de novo daqui a pouco' }
    const withPeriod = (starts_at, ends_at) => [...baseRows.filter(r => !(r.weekday === weekday && r.period === period)), { weekday, period, starts_at, ends_at }]
    if (!state.availability) { state.availability = { userId: target.id, rows: original }; save() }
    await setAvailability(target.id, withPeriod(period === 'manha' ? '00:00' : '12:00', hhmm(end)))
    const [item] = await newItems([{ title, ...source, assignee_id: target.id, remaining_minutes: minutes + 60 }])
    await must('POST', 'maker_blocks', { work_item_id: item.id, user_id: target.id, day: today, period, minutes })
    await setAvailability(target.id, withPeriod(period === 'manha' ? '00:00' : '12:00', hhmm(Math.max(period === 'manha' ? 0 : 720, nowParts().clock))))
    return { item, period, minutes }
  }

  if (mode === 'preparar') {
    const made = await makeOverdue(original, 'AUTO Bloco vencido', { ticket_id: openTicket.id, event_id: null })
    if (made.skip) { await undo(state); stop(made.skip + '.') }
    console.log(`Pronto: "${made.item.title}" (${made.minutes} min) está vencido na agenda de ${target.name}, hoje à ${made.period === 'manha' ? 'manhã' : 'tarde'}.`)
    console.log(`Para isso, o horário de ${target.name} neste período de hoje foi encurtado para terminar agora.`)
    console.log('Depois de avaliar, rode:  npm run test:homolog -- --restaurar   (restaura o horário e remove o bloco e a etapa).')
    return
  }

  // ---------- cenários automáticos ----------
  const standard = [1, 2, 3, 4, 5].flatMap(weekday => [{ weekday, period: 'manha', starts_at: '08:00', ends_at: '12:00' }, weekday === 5 ? { weekday, period: 'tarde', starts_at: '12:00', ends_at: '12:00' } : { weekday, period: 'tarde', starts_at: '13:00', ends_at: '17:00' }])
  state.availability = { userId: target.id, rows: original }; save()
  await setAvailability(target.id, standard)
  // Duas semanas seguidas, a partir de três semanas à frente, sem nada na agenda da pessoa.
  const thisMonday = plus(1 - isodow(today)); let monday = null, weeksAhead = 0
  for (let w = 3; w <= 14 && !monday; w++) {
    const from = plus(7 * w, thisMonday), to = plus(13, from)
    const busy = await must('GET', `maker_blocks?select=id&user_id=eq.${target.id}&day=gte.${from}&day=lte.${to}&status=in.(planned,needs_reschedule)&limit=1`)
    const events = (await must('GET', `maker_events?select=id,participant_ids&day=gte.${from}&day=lte.${to}&status=eq.confirmed`)).filter(e => e.participant_ids.includes(target.id))
    if (!busy.length && !events.length) { monday = from; weeksAhead = w }
  }
  if (!monday) { await undo(state); stop('não achei duas semanas livres na agenda de ' + target.name + '.') }
  const wd = n => plus(n, monday)
  const newEvent = async (title, day, start, end) => { const id = await must('POST', 'rpc/maker_create_event', { payload: { title, kind: 'aula', day, starts_at: start, ends_at: end, location: null, participant_ids: [target.id], preparation_deadline: null }, preparations: [], occurrences: 1 }); state.events.push(id); save(); return id }
  const N = { aula: `AUTO Aula ${run}`, cortar: `AUTO Cortar ${run}`, montar: `AUTO Montar ${run}`, lixar: `AUTO Lixar ${run}`, conflito: `AUTO Conflito ${run}`, vencido: `AUTO Vencido ${run}`, workshop: `AUTO Workshop ${run}`, preparar: `AUTO Preparar ${run}` }
  await newEvent(N.aula, wd(2), '08:00', '12:00')
  const anchor = await newEvent(`AUTO Oficina ${run}`, wd(11), '14:00', '16:00') // dá prazo às etapas
  const made = await newItems([
    { title: N.cortar, event_id: anchor, ticket_id: null, assignee_id: target.id, remaining_minutes: 240 },
    { title: N.montar, event_id: null, ticket_id: openTicket.id, assignee_id: target.id, remaining_minutes: 120 },
    { title: N.lixar, event_id: anchor, ticket_id: null, assignee_id: target.id, remaining_minutes: 180 },
    { title: N.conflito, event_id: anchor, ticket_id: null, assignee_id: target.id, remaining_minutes: 240 },
  ])
  const id = title => made.find(i => i.title === title).id
  console.log(`Preparação: horários padrão para ${target.name}, 2 eventos e 4 etapas "AUTO" na semana de ${br(monday)}.\n`)

  const { chromium } = require('playwright')
  let base = 'http://localhost:5173', vite = null
  if (!(await fetch(base).then(r => r.ok).catch(() => false))) {
    const { createServer } = await import('vite')
    vite = await createServer({ root: repo, server: { host: '127.0.0.1', port: 5184, strictPort: true } }); await vite.listen(); base = 'http://127.0.0.1:5184'
  }
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], otherHosts = new Set(); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept())
  await page.route(/supabase\.co/, route => { const host = new URL(route.request().url()).origin; if (host !== URL_) { otherHosts.add(host); return route.abort() } return route.continue() })
  const slot = (name, day, period) => page.locator(`section[aria-label="${name}, ${br(day)} · ${period}"]`)
  const side = page.getByRole('complementary', { name: 'Etapas a agendar' }), notice = page.locator('.board-notice'), dialog = page.getByRole('dialog')
  const T = { timeout: 15000 }
  const drag = async (from, to) => {
    await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 }); await page.waitForTimeout(100)
    await to.scrollIntoViewIfNeeded(); const b = await to.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 8 }); await page.waitForTimeout(100)
    await page.mouse.move(b.x + b.width / 2, b.y + 24, { steps: 2 }); await page.mouse.up()
  }
  const openWeek = async () => {
    await page.goto(base + '/planejamento'); await page.getByRole('heading', { name: 'Planejamento de equipe', exact: true }).waitFor(T); await page.locator('.board-slot').first().waitFor(T)
  }
  const forward = async weeks => { for (let i = 0; i < weeks; i++) await page.getByRole('button', { name: 'Próxima semana' }).click() }
  const step = async (cenario, body) => {
    try { const detail = await body(); record(cenario, detail && detail.skip ? null : true, detail && detail.skip ? detail.skip : typeof detail === 'string' ? detail : '') }
    catch (e) { record(cenario, false, String(e.message).split('\n')[0]); await page.screenshot({ path: path.join(shots, 'falha-' + results.length + '.png'), fullPage: true }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}) }
  }

  try {
    await step('Login real pela tela e abertura do Planejamento', async () => {
      await page.goto(base + '/login'); await page.locator('#email').fill(EMAIL); await page.locator('#password').fill(SENHA); await page.locator('button[type=submit]').click()
      await page.waitForURL(u => !u.pathname.startsWith('/login'), T)
      await openWeek(); await side.getByRole('button', { name: new RegExp(N.cortar) }).waitFor(T); await forward(weeksAhead); await slot(target.name, wd(0), 'manhã').waitFor(T)
    })
    await step('Evento ocupa só o seu período, como ocupação fixa', async () => {
      await slot(target.name, wd(2), 'manhã').getByText('Aula: ' + N.aula).waitFor(T); await slot(target.name, wd(2), 'manhã').getByText('0h livres').waitFor(T)
      assert.equal(await slot(target.name, wd(2), 'tarde').locator('.board-fixed').count(), 0); await slot(target.name, wd(2), 'tarde').getByText('4h livres').waitFor(T)
    })
    await step('Reserva parcial por arraste (banco grava 2h de 4h; saldo fica na lista)', async () => {
      await drag(side.getByRole('button', { name: new RegExp(N.cortar) }), slot(target.name, wd(0), 'manhã'))
      await dialog.getByRole('heading', { name: 'Quanto tempo reservar?' }).waitFor(T); await dialog.getByLabel('Duração do bloco · horas').fill('2'); await dialog.getByRole('button', { name: 'Reservar' }).click()
      await notice.filter({ hasText: 'Reserva gravada' }).filter({ hasText: 'Ainda faltam agendar 2h' }).waitFor(T)
      await side.getByRole('button', { name: new RegExp(N.cortar) }).getByText('Faltam agendar 2h').waitFor(T)
      const b = await blocksOf(id(N.cortar)); assert.equal(b.length, 1); assert.deepEqual([b[0].day, b[0].period, b[0].minutes, b[0].status, b[0].user_id], [wd(0), 'manha', 120, 'planned', target.id])
    })
    await step('Vários cartões no mesmo período', async () => {
      await drag(side.getByRole('button', { name: new RegExp(N.montar) }), slot(target.name, wd(0), 'manhã'))
      await dialog.getByRole('button', { name: 'Reservar' }).click(); await notice.filter({ hasText: 'Reserva gravada' }).waitFor(T)
      await slot(target.name, wd(0), 'manhã').getByText('0h livres').waitFor(T); assert.equal(await slot(target.name, wd(0), 'manhã').locator('.board-card').count(), 2)
      assert.equal(await side.getByRole('button', { name: new RegExp(N.montar) }).count(), 0)
    })
    await step('Destinos recusados mostram o motivo (cheio, evento, indisponível, outro responsável)', async () => {
      await side.getByRole('button', { name: new RegExp(N.lixar) }).click(); await dialog.getByRole('button', { name: 'Reservar em um período' }).click()
      await slot(target.name, wd(0), 'manhã').getByText('Sem horas livres').waitFor(T)
      await slot(target.name, wd(2), 'manhã').getByText('Ocupado: ' + N.aula).waitFor(T)
      await slot(target.name, wd(4), 'tarde').locator('.board-reason', { hasText: 'Indisponível' }).waitFor(T)
      await slot(me.name, wd(0), 'manhã').getByText('Outro responsável').waitFor(T)
      assert.equal(await slot(target.name, wd(0), 'manhã').getByRole('button', { name: 'Colocar aqui' }).count(), 0)
    })
    await step('Reserva sem arrastar (botão "Colocar aqui")', async () => {
      await slot(target.name, wd(1), 'manhã').getByRole('button', { name: 'Colocar aqui' }).click()
      await dialog.getByRole('heading', { name: 'Quanto tempo reservar?' }).waitFor(T); await dialog.getByRole('button', { name: 'Reservar' }).click()
      await notice.filter({ hasText: 'Reserva gravada: ' + N.lixar }).waitFor(T)
      const b = await blocksOf(id(N.lixar)); assert.deepEqual([b.length, b[0].day, b[0].period, b[0].minutes], [1, wd(1), 'manha', 180])
    })
    await step('Banco recusa reserva acima da capacidade (chamada direta, sem a tela)', async () => {
      const r = await rest('POST', 'maker_blocks', { work_item_id: id(N.cortar), user_id: target.id, day: wd(0), period: 'manha', minutes: 60 })
      assert.equal(r.ok, false); assert.match(r.message || '', /excede o tempo disponível/); return `mensagem do banco: "${r.message}"`
    })
    await step('Banco recusa reserva em período ocupado por evento (chamada direta)', async () => {
      const r = await rest('POST', 'maker_blocks', { work_item_id: id(N.cortar), user_id: target.id, day: wd(2), period: 'manha', minutes: 60 })
      assert.equal(r.ok, false); assert.match(r.message || '', /excede o tempo disponível/)
    })
    await step('Banco recusa bloco para quem não é o responsável (chamada direta)', async () => {
      const r = await rest('POST', 'maker_blocks', { work_item_id: id(N.cortar), user_id: me.id, day: wd(3), period: 'tarde', minutes: 60 })
      assert.equal(r.ok, false); assert.match(r.message || '', /responsável da etapa/)
    })
    await step('Banco recusa reserva no passado (chamada direta)', async () => {
      const r = await rest('POST', 'maker_blocks', { work_item_id: id(N.cortar), user_id: target.id, day: plus(-7, thisMonday), period: 'manha', minutes: 60 })
      assert.equal(r.ok, false); assert.match(r.message || '', /passado/)
    })
    await step('Conflito com outra sessão: banco recusa, nada muda de lugar e o motivo aparece', async () => {
      // Outra "sessão" ocupa a quinta de manhã depois de a tela ter carregado.
      await must('POST', 'maker_blocks', { work_item_id: id(N.conflito), user_id: target.id, day: wd(3), period: 'manha', minutes: 240 })
      await drag(side.getByRole('button', { name: new RegExp(N.cortar) }), slot(target.name, wd(3), 'manhã'))
      try { await dialog.getByRole('heading', { name: 'Quanto tempo reservar?' }).waitFor({ timeout: 6000 }) } catch { return { skip: 'a tela se atualizou sozinha antes do arraste; rode de novo' } }
      await dialog.getByRole('button', { name: 'Reservar' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'Não foi gravado' }); await alert.waitFor(T)
      const text = await alert.innerText(); assert.match(text, /excede o tempo disponível/); assert.match(text, /Nenhuma reserva foi criada/)
      assert.equal(await notice.filter({ hasText: 'Reserva gravada' }).count(), 0)
      assert.equal((await blocksOf(id(N.cortar))).length, 1, 'nenhum bloco novo no banco')
      await slot(target.name, wd(3), 'manhã').locator('.board-card', { hasText: N.conflito }).waitFor(T)
      assert.equal(await slot(target.name, wd(3), 'manhã').locator('.board-card', { hasText: N.cortar }).count(), 0)
      await page.screenshot({ path: path.join(shots, 'conflito.png'), fullPage: true })
    })
    await step('Remanejar bloco por arraste: sem formulário, mesma duração, histórico no banco', async () => {
      await page.getByRole('button', { name: 'Fechar aviso' }).click().catch(() => {})
      const before = (await blocksOf(id(N.lixar)))[0]
      await drag(slot(target.name, wd(1), 'manhã').locator('.board-card', { hasText: N.lixar }), slot(target.name, wd(1), 'tarde'))
      await notice.filter({ hasText: 'Remanejado: ' + N.lixar }).waitFor(T); assert.equal(await dialog.count(), 0)
      const after = await blocksOf(id(N.lixar)); const old = after.find(b => b.id === before.id), next = after.find(b => b.id !== before.id)
      assert.equal(after.length, 2); assert.equal(old.status, 'superseded'); assert.deepEqual([next.status, next.day, next.period, next.minutes, next.predecessor_id, next.user_id], ['planned', wd(1), 'tarde', 180, before.id, target.id])
      await slot(target.name, wd(1), 'tarde').locator('.board-card', { hasText: N.lixar }).click(); await dialog.getByText(/remanejado de/).waitFor(T); await dialog.getByRole('button', { name: 'Fechar' }).click()
    })
    await step('Concluir etapa não conclui a demanda', async () => {
      await slot(target.name, wd(0), 'manhã').locator('.board-card', { hasText: N.montar }).click(); await dialog.getByRole('button', { name: 'Concluir etapa' }).click()
      await notice.filter({ hasText: 'Etapa concluída: ' + N.montar }).waitFor(T)
      const item = (await must('GET', `maker_work_items?select=status&id=eq.${id(N.montar)}`))[0], b = await blocksOf(id(N.montar))
      const ticket = (await must('GET', `tickets?select=status&id=eq.${openTicket.id}`))[0]
      assert.equal(item.status, 'completed'); assert.equal(b[0].status, 'done'); assert.equal(ticket.status, openTicket.status)
      return `demanda "${openTicket.titulo}" continua "${ticket.status}"`
    })
    await page.screenshot({ path: path.join(shots, 'agenda.png'), fullPage: true })

    await step('Aula cadastrada pela tela, sem triagem, com 2 ocorrências e preparação', async () => {
      const ticketsBefore = allTickets.length
      await page.goto(base + '/eventos'); await page.getByRole('button', { name: 'Novo evento', exact: true }).click(); const form = page.getByRole('dialog')
      await form.getByRole('heading', { name: 'Novo evento · sem triagem' }).waitFor(T)
      await form.locator('[name=title]').fill(N.workshop); await form.locator('[name=day]').fill(wd(3)); await form.locator('[name=start]').fill('14:00'); await form.locator('[name=end]').fill('16:00')
      await form.locator('label.event-chip', { hasText: target.name }).locator('input').check(); await form.locator('[name=occurrences]').fill('2'); await form.locator('[name=preparation]').fill(N.preparar)
      await form.getByRole('button', { name: 'Cadastrar evento' }).click(); await form.waitFor({ state: 'hidden', ...T })
      const events = await must('GET', `maker_events?select=id,day,series_id,status,participant_ids&title=eq.${encodeURIComponent(N.workshop)}&order=day`)
      state.events.push(...events.map(e => e.id)); save()
      assert.equal(events.length, 2); assert.deepEqual(events.map(e => e.day), [wd(3), wd(10)]); assert.ok(events[0].series_id && events[0].series_id === events[1].series_id)
      const prep = await must('GET', `maker_work_items?select=id,event_id&title=eq.${encodeURIComponent(N.preparar)}`); assert.equal(prep.length, 2, 'uma etapa de preparação por ocorrência')
      const ticketsAfter = (await must('GET', 'tickets?select=id')).length; assert.equal(ticketsAfter, ticketsBefore, 'nenhuma demanda criada: o evento não passa pela triagem')
      await openWeek(); await forward(weeksAhead)
      await slot(target.name, wd(3), 'tarde').getByText('Aula: ' + N.workshop).waitFor(T)
      const label = await slot(target.name, wd(3), 'tarde').locator('header span').innerText(); assert.equal(label, '2h livres', 'aula de 2h reduz a tarde de 4h para 2h')
      const r = await rest('POST', 'maker_events', { title: N.workshop, kind: 'aula', day: wd(3), starts_at: '15:00', ends_at: '17:00', participant_ids: [target.id] }, 'return=representation')
      if (r.ok) { state.events.push(...r.data.map(e => e.id)); save() }
      assert.equal(r.ok, false); assert.match(r.message || '', /outro evento nesse horário/)
      return `tarde de ${br(wd(3))}: ${label}; evento sobreposto recusado pelo banco`
    })

    await step('Bloco vencido criado sem contornar o banco fica vermelho e é remanejado com histórico', async () => {
      const overdue = await makeOverdue(standard, N.vencido, { event_id: anchor, ticket_id: null })
      if (overdue.skip) return overdue
      const periodName = overdue.period === 'manha' ? 'manhã' : 'tarde'
      await openWeek()
      await side.getByText(/Precisa remanejar · \d+/).waitFor(T); await side.locator('.board-item.missed', { hasText: N.vencido }).waitFor(T)
      await slot(target.name, today, periodName).locator('.board-card.missed', { hasText: N.vencido }).getByText('Precisa remanejar').waitFor(T)
      await page.screenshot({ path: path.join(shots, 'bloco-vencido.png'), fullPage: true })
      const before = (await blocksOf(overdue.item.id))[0]
      await side.locator('.board-item.missed', { hasText: N.vencido }).click(); await dialog.getByText('Precisa remanejar.').waitFor(T)
      await dialog.getByRole('button', { name: 'Mover para outro período' }).click(); await forward(weeksAhead)
      await slot(target.name, wd(3), 'tarde').getByRole('button', { name: 'Colocar aqui' }).click()
      await dialog.getByRole('heading', { name: 'Quanto falta e quanto reservar agora?' }).waitFor(T)
      await dialog.getByLabel('Total de trabalho ainda restante · horas').fill('2'); await dialog.getByLabel('Duração da nova reserva · horas').fill('1'); await dialog.getByRole('button', { name: 'Remanejar' }).click()
      await notice.filter({ hasText: 'Remanejado: ' + N.vencido }).waitFor(T)
      const after = await blocksOf(overdue.item.id), old = after.find(b => b.id === before.id), next = after.find(b => b.id !== before.id)
      const item = (await must('GET', `maker_work_items?select=remaining_minutes&id=eq.${overdue.item.id}`))[0]
      assert.equal(old.status, 'superseded'); assert.deepEqual([next.status, next.day, next.period, next.minutes, next.predecessor_id], ['planned', wd(3), 'tarde', 60, before.id]); assert.equal(item.remaining_minutes, 120)
      assert.equal(await side.locator('.board-item.missed', { hasText: N.vencido }).count(), 0)
      await side.getByRole('button', { name: new RegExp(N.vencido) }).getByText('Faltam agendar 1h').waitFor(T)
      return `bloco de ${overdue.minutes} min de hoje (${periodName}) remanejado para ${br(wd(3))}`
    })
    await setAvailability(target.id, standard).catch(() => {})

    // ---------- planejamento assistido (exige migration-maker-assisted-planning.sql) ----------
    const assisted = (await rest('GET', 'maker_time_off?select=id&limit=1')).ok
    if (!assisted) record('Planejamento assistido', null, 'migration-maker-assisted-planning.sql ainda não foi aplicada neste banco')
    else {
      const planned = new Set((await must('GET', 'maker_work_items?select=ticket_id&ticket_id=not.is.null')).map(i => i.ticket_id))
      const free = allTickets.filter(t => !['entregue', 'cancelada'].includes(t.status) && !planned.has(t.id) && /^Demanda ficticia \d/.test(t.titulo))
      const [A, B, C] = free
      const adopt = async ticket => { const ids = (await must('GET', `maker_work_items?select=id&ticket_id=eq.${ticket.id}`)).map(i => i.id); state.items.push(...ids.filter(i => !state.items.includes(i))); save(); return ids }
      const cardOf = async ticket => (await must('GET', `maker_work_items?select=*&ticket_id=eq.${ticket.id}&scope=eq.demanda&order=created_at`)).at(-1)
      const reservedByPeriod = async () => { const m = {}; for (const b of await must('GET', `maker_blocks?select=day,period,minutes&user_id=eq.${target.id}&status=eq.planned&day=gte.${wd(7)}&day=lte.${wd(11)}`)) m[b.day + '|' + b.period] = (m[b.day + '|' + b.period] ?? 0) + b.minutes; return m }
      const limitOf = async key => { const [d, p] = key.split('|'); return (await must('POST', 'rpc/maker_slack_limit', { person: target.id, d, p })) }
      const withinSlack = async () => { const now = await reservedByPeriod(); for (const key of Object.keys(now)) assert.ok(now[key] <= await limitOf(key), `${key}: ${now[key]} min reservados passam do limite sem folga`); return now }
      const openPlanner = async ticket => {
        await openWeek(); await page.getByText(/Fora do planejamento · \d+/).click()
        await page.locator('.board-more-row', { hasText: ticket.titulo }).getByRole('button', { name: 'Planejar demanda inteira' }).click()
        await dialog.getByRole('heading', { name: 'Planejar demanda inteira: ' + ticket.titulo }).waitFor(T)
        await dialog.getByLabel('Responsável').selectOption(target.id); await dialog.getByLabel('Não começar antes de').fill(wd(7))
      }
      const proposalRegion = dialog.getByRole('region', { name: 'Proposta' })
      if (!C) record('Planejamento assistido', null, 'faltam demandas fictícias em aberto sem etapas para o teste')
      else {
        await step('Assistido: a proposta não grava nada; ao aceitar, cartão, blocos e histórico entram juntos', async () => {
          const prazo = (await must('GET', `tickets?select=data_entrega&id=eq.${A.id}`))[0].data_entrega
          await openPlanner(A); await dialog.getByLabel('Trabalho previsto · horas').fill('9')
          assert.deepEqual(await proposalRegion.locator('.planner-table tbody tr td:first-child').allInnerTexts(), ['Só a estimativa', 'Com a margem', 'Com a margem e a folga'])
          assert.equal(await cardOf(A), undefined, 'nada no banco antes do aceite')
          await dialog.getByRole('button', { name: 'Aceitar proposta' }).click(); await notice.filter({ hasText: 'Proposta aceita: ' + A.titulo }).filter({ hasText: 'O prazo oficial não foi alterado' }).waitFor(T)
          await adopt(A); const card = await cardOf(A), blocks = await blocksOf(card.id)
          assert.deepEqual([card.scope, card.estimate_mode, card.work_minutes, card.protection_minutes, card.remaining_minutes, card.assignee_id], ['demanda', 'estimativa', 540, 120, 660, target.id])
          assert.equal(blocks.reduce((n, b) => n + b.minutes, 0), 660); assert.equal(blocks.filter(b => b.purpose === 'protecao').reduce((n, b) => n + b.minutes, 0), 120)
          const log = await must('GET', `maker_estimate_log?select=reason,work_minutes,protection_minutes&work_item_id=eq.${card.id}`)
          assert.deepEqual(log, [{ reason: 'inicial', work_minutes: 540, protection_minutes: 120 }])
          assert.equal((await must('GET', `tickets?select=data_entrega&id=eq.${A.id}`))[0].data_entrega, prazo, 'aceitar reservas não altera o prazo oficial')
          await withinSlack(); return `9h + 2h de proteção em ${new Set(blocks.map(b => b.day + b.period)).size} períodos`
        })
        await step('Assistido: uma segunda proposta não consome a folga protegida', async () => {
          await openPlanner(B); await dialog.getByLabel('Trabalho previsto · horas').fill('6'); await dialog.getByLabel('Margem de erro · %').fill('0')
          await dialog.getByRole('button', { name: 'Aceitar proposta' }).click(); await notice.filter({ hasText: 'Proposta aceita: ' + B.titulo }).waitFor(T)
          await adopt(B); const now = await withinSlack()
          return `${Object.keys(now).length} períodos ocupados, todos dentro do limite sem folga`
        })
        await step('Assistido: "não sei ainda" com conflito de outra sessão não grava nada; depois reserva só a investigação', async () => {
          await openPlanner(C); await dialog.getByLabel('Não sei ainda').check()
          await proposalRegion.getByText('Sem previsão de conclusão:').waitFor(T); assert.equal(await proposalRegion.locator('.planner-table').count(), 0)
          await dialog.getByLabel('Revisar a estimativa em').fill(today)
          const label = await proposalRegion.locator('.planner-blocks li span').first().innerText(), [dayBr, per] = label.split(' · ')
          const d = dayBr.split('/').reverse().join('-'), p = per === 'manhã' ? 'manha' : 'tarde'
          // Outra sessão ocupa o período sugerido inteiro depois de a proposta ter sido calculada.
          const capacity = await must('POST', 'rpc/maker_period_capacity', { person: target.id, d, p }), taken = (await reservedByPeriod())[d + '|' + p] ?? 0
          await must('POST', 'maker_blocks', { work_item_id: id(N.conflito), user_id: target.id, day: d, period: p, minutes: capacity - taken })
          await dialog.getByRole('button', { name: 'Aceitar proposta' }).click()
          await dialog.getByRole('alert').filter({ hasText: 'Não foi gravado' }).filter({ hasText: 'Nada foi reservado' }).waitFor(T)
          assert.equal(await cardOf(C), undefined, 'recusa do banco não deixa cartão nem bloco')
          const again = await proposalRegion.locator('.planner-blocks li span').first().innerText(); assert.notEqual(again, label, 'a proposta foi recalculada com a agenda atual')
          await dialog.getByRole('button', { name: 'Aceitar proposta' }).click(); await notice.filter({ hasText: 'Revisão da estimativa em' }).waitFor(T)
          await adopt(C); const card = await cardOf(C), blocks = await blocksOf(card.id)
          assert.deepEqual([card.estimate_mode, card.work_minutes, card.review_on], ['indefinida', null, today]); assert.deepEqual(blocks.map(b => [b.purpose, b.minutes, b.status]), [['investigacao', 120, 'planned']])
          return `primeira sugestão ${label} ocupada por outra sessão; aceita em ${again}`
        })
        await step('Assistido: "Revisar estimativa" tem alerta próprio; a faixa substitui a investigação e guarda o histórico', async () => {
          await openWeek(); await side.getByText(/Revisar estimativa · \d+/).waitFor(T)
          assert.equal(await side.locator('.board-item.missed', { hasText: C.titulo }).count(), 0, 'revisão não aparece como atraso')
          await side.locator('.board-item.review', { hasText: C.titulo }).click(); await dialog.getByRole('button', { name: 'Definir estimativa' }).click()
          await dialog.getByLabel('Tenho uma faixa').check(); await dialog.getByLabel('Não começar antes de').fill(wd(7))
          await dialog.getByLabel('Cenário menor · horas').fill('3'); await dialog.getByLabel('Cenário maior · horas').fill('5')
          assert.deepEqual(await proposalRegion.locator('.planner-table tbody tr td:first-child').allInnerTexts(), ['Se for o cenário menor', 'Se for o cenário maior'])
          await dialog.getByRole('button', { name: 'Aceitar proposta' }).click(); await notice.filter({ hasText: 'Proposta aceita: ' + C.titulo }).waitFor(T)
          const card = await cardOf(C), blocks = await blocksOf(card.id), active = blocks.filter(b => b.status === 'planned')
          assert.deepEqual([card.estimate_mode, card.work_minutes, card.protection_minutes, card.remaining_minutes], ['faixa', 180, 120, 300])
          assert.equal(blocks.find(b => b.purpose === 'investigacao').status, 'superseded')
          assert.equal(active.filter(b => b.purpose === 'trabalho').reduce((n, b) => n + b.minutes, 0), 180); assert.equal(active.filter(b => b.purpose === 'protecao').reduce((n, b) => n + b.minutes, 0), 120)
          const log = await must('GET', `maker_estimate_log?select=reason,mode,low_minutes,high_minutes&work_item_id=eq.${card.id}&order=created_at`)
          assert.deepEqual(log, [{ reason: 'inicial', mode: 'indefinida', low_minutes: null, high_minutes: null }, { reason: 'revisao', mode: 'faixa', low_minutes: 180, high_minutes: 300 }])
          await withinSlack()
        })
        await step('Assistido: banco impede demanda inteira e etapas da mesma demanda ao mesmo tempo', async () => {
          const r = await rest('POST', 'maker_work_items', { title: N.cortar + ' etapa', ticket_id: A.id, assignee_id: target.id, remaining_minutes: 60 }, 'return=representation')
          if (r.ok) { state.items.push(r.data[0].id); save() }
          assert.equal(r.ok, false); assert.match(r.message || '', /demanda inteira/)
          const again = await rest('POST', 'rpc/maker_accept_plan', { plan: { ticket_id: A.id, title: A.titulo, assignee_id: target.id, scope: 'demanda', mode: 'estimativa', work_minutes: 60, blocks: [{ day: wd(11), period: 'manha', minutes: 60 }] } })
          assert.equal(again.ok, false)
        })
        await step('Assistido: transformar em etapas repassa as reservas sem duplicar horas', async () => {
          const card = await cardOf(A), before = await reservedByPeriod(), had = (await blocksOf(card.id)).filter(b => b.status === 'planned').reduce((n, b) => n + b.minutes, 0)
          await openWeek(); await forward(weeksAhead + 1)
          await page.locator('.board-card', { hasText: A.titulo }).first().click(); await dialog.getByRole('button', { name: 'Transformar em etapas' }).click()
          await dialog.getByLabel('Nome da etapa 1').fill(N.cortar + ' A'); await dialog.getByLabel('Trabalho da etapa 1 em horas').fill('5')
          await dialog.getByLabel('Nome da etapa 2').fill(N.cortar + ' B'); await dialog.getByLabel('Trabalho da etapa 2 em horas').fill('4'); await dialog.getByLabel('Proteção da etapa 2 em horas').fill('2')
          await dialog.getByRole('button', { name: 'Transformar em etapas' }).click(); await notice.filter({ hasText: 'foi transformada em 2 etapas' }).waitFor(T)
          const ids = await adopt(A), after = await reservedByPeriod(), old = (await must('GET', `maker_work_items?select=status,converted_at&id=eq.${card.id}`))[0]
          assert.equal(old.status, 'completed'); assert.ok(old.converted_at)
          assert.deepEqual(after, before, 'cada período continua com exatamente as mesmas horas reservadas')
          const steps = await must('GET', `maker_work_items?select=id,title,scope,status,remaining_minutes&ticket_id=eq.${A.id}&status=eq.pending`)
          assert.deepEqual(steps.map(s => [s.scope, s.remaining_minutes]).sort(), [['etapa', 300], ['etapa', 360]])
          let moved = 0; for (const s of steps) moved += (await blocksOf(s.id)).filter(b => b.status === 'planned').reduce((n, b) => n + b.minutes, 0)
          assert.equal(moved, had); assert.equal((await blocksOf(card.id)).filter(b => b.status === 'planned').length, 0)
          return `${had / 60}h de reservas passaram para ${steps.length} etapas (${ids.length} registros na demanda)`
        })
        await step('Assistido: ausência cadastrada tira a capacidade do período, na tela e no banco', async () => {
          const off = await must('POST', 'maker_time_off', { user_id: target.id, day: wd(11), period: 'manha', reason: 'AUTO Ausência ' + run }, 'return=representation')
          state.timeOff.push(off[0].id); save()
          assert.equal(await must('POST', 'rpc/maker_period_capacity', { person: target.id, d: wd(11), p: 'manha' }), 0)
          const r = await rest('POST', 'maker_blocks', { work_item_id: id(N.conflito), user_id: target.id, day: wd(11), period: 'manha', minutes: 15 })
          assert.equal(r.ok, false); assert.match(r.message || '', /excede o tempo disponível/)
          await openWeek(); await forward(weeksAhead + 1)
          await slot(target.name, wd(11), 'manhã').getByText('Ausência: AUTO Ausência ' + run).waitFor(T)
          await page.screenshot({ path: path.join(shots, 'assistido.png'), fullPage: true })
        })
        await step('Assistido: banco recusa proposta que entraria na folga sem confirmação, e registra o uso confirmado', async () => {
          const full = Object.entries(await reservedByPeriod()).find(([, minutes]) => minutes > 0)[0], [d, p] = full.split('|')
          const lim = await limitOf(full), now = (await reservedByPeriod())[full], item = id(N.cortar)
          const plan = extra => ({ plan: { item_id: item, assignee_id: target.id, mode: 'estimativa', work_minutes: 240, protection_minutes: 0, blocks: [{ day: d, period: p, minutes: lim - now + 15, purpose: 'trabalho' }], ...extra } })
          const refused = await rest('POST', 'rpc/maker_accept_plan', plan({})); assert.equal(refused.ok, false); assert.match(refused.message || '', /folga protegida/)
          assert.equal((await blocksOf(item)).filter(b => b.status === 'planned').length, 1, 'recusa não muda as reservas da etapa')
          await must('POST', 'rpc/maker_accept_plan', plan({ use_slack: true }))
          const note = (await must('GET', `maker_estimate_log?select=note&work_item_id=eq.${item}&reason=eq.folga`))[0].note; assert.match(note, /15 min da folga protegida/)
          return `recusa: "${refused.message}"`
        })
      }
    }

    await step('Dashboard com o banco real: números conferem com o banco e os indicadores abrem as listas', async () => {
      const tickets = await must('GET', 'tickets?select=id,status,responsavel_id,data_entrega,entregue_em&excluida_em=is.null&limit=5000')
      const localDay = ts => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts))
      const deliveredSince = days => tickets.filter(t => t.status === 'entregue' && t.entregue_em && localDay(t.entregue_em) >= plus(-(days - 1)) && localDay(t.entregue_em) <= today).length
      const open = tickets.filter(t => !['entregue', 'cancelada'].includes(t.status))
      const card = label => page.locator(`.dash-kpi:has(.dash-kpi-label:text-is("${label}"))`)
      const kpi = async label => (await card(label).locator('.dash-kpi-value').innerText()).trim()
      await page.goto(base + '/'); await page.getByRole('heading', { name: 'Dashboard do Espaço Maker' }).waitFor(T); await page.getByText('Capacidade da equipe').waitFor(T)
      await page.locator('.dash-kpi-value').first().waitFor(T); await page.waitForFunction(() => document.querySelector('.dash-kpi-value')?.textContent !== '0', null, T).catch(() => {})
      assert.equal(await kpi('Em aberto'), String(open.length)); assert.equal(await kpi('Entregues no período'), String(deliveredSince(90)))
      assert.equal(await kpi('Atrasadas'), String(open.filter(t => t.data_entrega && t.data_entrega.slice(0, 10) < today).length))
      await card('Entregues no período').click(); await dialog.locator('li').first().waitFor(T)
      assert.equal(await dialog.locator('li').count(), deliveredSince(90)); await dialog.getByRole('button', { name: 'Fechar' }).click()
      await card('Atrasadas').click(); await dialog.locator('h2').waitFor(T); assert.match(await dialog.locator('h2').innerText(), /Demandas atrasadas/); await dialog.getByRole('button', { name: 'Fechar' }).click()
      await page.getByLabel('Período').selectOption('365'); await page.waitForTimeout(500); assert.equal(await kpi('Entregues no período'), String(deliveredSince(365)))
      await page.getByLabel('Responsável').selectOption(target.id); await page.waitForTimeout(500); assert.equal(await kpi('Em aberto'), String(open.filter(t => t.responsavel_id === target.id).length))
      await page.screenshot({ path: path.join(shots, 'dashboard.png'), fullPage: true })
      return `90 dias: ${deliveredSince(90)} entregas · 12 meses: ${deliveredSince(365)} · em aberto de ${target.name}: ${open.filter(t => t.responsavel_id === target.id).length}`
    })
    record('Nenhuma chamada a outro banco e nenhum erro de script na página', !otherHosts.size && !errors.length, [...otherHosts, ...errors].join(' | '))
  } finally {
    await browser.close(); if (vite) await vite.close()
    await undo(state); console.log(`\nLimpeza: horários de ${target.name} restaurados e registros criados por esta execução removidos.`)
  }
  const failed = results.filter(r => r.ok === false).length, unsure = results.filter(r => r.ok === null).length
  console.log(`\nResumo (banco real de homologação): ${results.length - failed - unsure} ok, ${failed} falharam, ${unsure} não executados. Capturas em ${shots}`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('\nErro inesperado:', String(e.message).split(SENHA || '\u0000').join('***'), '\nSe algo ficou no banco, rode: npm run test:homolog -- --restaurar'); process.exit(1) })
