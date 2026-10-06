// Smoke test de interface: Chromium + Vite local + Supabase simulado. Não usa credenciais nem rede de produção.
const assert = require('node:assert/strict'); const { chromium: pw } = require('playwright'); const path = require('node:path'); const os = require('node:os')
const PORT = 5183 // porta própria: não disputa com um `npm run dev` aberto em 5173
const shot = name => path.join(os.tmpdir(), name)
;(async () => {
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'; process.env.VITE_SUPABASE_ANON_KEY = 'test-key'
  const { createServer } = await import('vite')
  const vite = await createServer({ root: path.resolve(__dirname, '..'), server: { host: '127.0.0.1', port: PORT, strictPort: true } }); await vite.listen()
  const base = `http://127.0.0.1:${PORT}`
  const browser = await pw.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = [], confirms = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { confirms.push(d.message()); d.accept() })

  const user = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002', ticket = '00000000-0000-0000-0000-000000000003', ticket2 = '00000000-0000-0000-0000-000000000004'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
  const plus = (n, from = today) => { const d = new Date(from + 'T12:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const br = day => day.split('-').reverse().join('/')
  // Tudo acontece na semana que vem, para o teste não depender da hora em que roda.
  const monday = plus(7 - ((new Date(today + 'T12:00Z').getUTCDay() + 6) % 7)), week = n => plus(n, monday)
  const payload = { sub: user, exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) }
  const token = [{ alg: 'HS256', typ: 'JWT' }, payload].map(o => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') + '.test'
  await page.addInitScript(({ token, user }) => localStorage.setItem('sb-test-auth-token', JSON.stringify({ access_token: token, refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400, token_type: 'bearer', user: { id: user, email: 'felipe@ctp.test', aud: 'authenticated', role: 'authenticated', user_metadata: { name: 'Felipe' } } })), { token, user })

  const users = [{ id: user, name: 'Felipe', role: 'felipe', can_access_feed: true }, { id: other, name: 'Manu', role: 'executor', can_access_feed: true }]
  const events = [{ id: 'e1', title: 'Aula de teste', kind: 'aula', day: week(2), starts_at: '08:00:00', ends_at: '12:00:00', participant_ids: [user, other], preparation_deadline: null, status: 'confirmed', location: 'Maker', series_id: null }]
  const items = [
    { id: 'i1', title: 'Modelar suporte', ticket_id: ticket, event_id: null, ticket_task_id: 1, assignee_id: user, remaining_minutes: 180, due_date: null, status: 'pending' },
    { id: 'i2', title: 'Imprimir peças', ticket_id: ticket, event_id: null, ticket_task_id: null, assignee_id: user, remaining_minutes: 240, due_date: null, status: 'pending' },
    { id: 'i3', title: 'Montar kit', ticket_id: ticket, event_id: null, ticket_task_id: null, assignee_id: other, remaining_minutes: 120, due_date: null, status: 'pending' },
  ]
  const blocks = [
    { id: 'b1', work_item_id: 'i1', user_id: user, day: plus(-7, monday), period: 'tarde', minutes: 180, status: 'planned', predecessor_id: null },
    { id: 'b3', work_item_id: 'i3', user_id: other, day: week(1), period: 'manha', minutes: 120, status: 'planned', predecessor_id: null },
  ]
  const availability = users.flatMap(u => [1, 2, 3, 4, 5].flatMap(weekday => ['manha', 'tarde'].map(period => ({ user_id: u.id, weekday, period, starts_at: period === 'manha' ? '08:00:00' : '13:00:00', ends_at: period === 'manha' ? '12:00:00' : '17:00:00' }))))
  const tickets = [{ id: ticket, titulo: 'Rover de teste', tipo: 'interna', origem: 'interno', categoria: 'engenharia', prioridade: 'media', status: 'em_producao', responsavel_id: user, data_criacao: today, data_entrega: week(11), responsavel: { id: user, name: 'Felipe' } },
    { id: ticket2, titulo: 'Braço robótico', tipo: 'interna', origem: 'interno', categoria: 'engenharia', prioridade: 'media', status: 'aprovado', responsavel_id: other, data_criacao: today, data_entrega: week(18), responsavel: { id: other, name: 'Manu' } }]
  const calls = []; let failNext = null, serial = 10
  await page.route('https://test.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').at(-1), body = req.postDataJSON(); let result = [], status = 200
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return }
    const write = req.method() !== 'GET' && !url.pathname.includes('/auth/')
    if (write && failNext) { status = 400; result = { code: 'P0001', message: failNext }; failNext = null; calls.push({ table, body, failed: true }) }
    else if (url.pathname.includes('/auth/')) result = { user: { id: user, email: 'felipe@ctp.test' } }
    else if (url.pathname.includes('/rpc/')) {
      calls.push({ table, body }); result = null
      if (table === 'maker_continue_block') {
        const b = blocks.find(b => b.id === body.block_id); items.find(i => i.id === b.work_item_id).remaining_minutes = body.remaining
        b.status = body.new_day ? 'superseded' : 'needs_reschedule'
        if (body.new_day) blocks.push({ ...b, id: 'b' + serial++, status: 'planned', day: body.new_day, period: body.new_period, minutes: body.new_minutes, predecessor_id: b.id })
      } else if (table === 'maker_complete_item') {
        items.find(i => i.id === body.item_id).status = 'completed'
        blocks.filter(b => b.work_item_id === body.item_id && ['planned', 'needs_reschedule'].includes(b.status)).forEach(b => { b.status = b.id === body.block_id ? 'done' : 'cancelled' })
      } else if (table === 'maker_accept_plan') {
        const plan = body.plan, id = 'i' + serial++
        items.push({ id, title: plan.title, ticket_id: plan.ticket_id, event_id: null, ticket_task_id: null, assignee_id: plan.assignee_id, remaining_minutes: (plan.work_minutes ?? 0) + (plan.protection_minutes ?? 0) || plan.blocks.reduce((n, b) => n + b.minutes, 0), due_date: null, status: 'pending', scope: plan.scope, estimate_mode: plan.mode, work_minutes: plan.work_minutes, protection_minutes: plan.protection_minutes ?? 0, review_on: plan.review_on ?? null })
        for (const b of plan.blocks) blocks.push({ id: 'b' + serial++, work_item_id: id, user_id: plan.assignee_id, day: b.day, period: b.period, minutes: b.minutes, status: 'planned', predecessor_id: null, purpose: b.purpose })
        result = id
      } else if (table === 'maker_create_event') { events.push({ ...body.payload, id: 'e2', status: 'confirmed', series_id: null }); result = 'e2' }
    }
    else if (table === 'maker_blocks' && req.method() === 'POST') { calls.push({ table, body }); blocks.push({ ...body, id: 'b' + serial++, status: 'planned', predecessor_id: null }); status = 201 }
    else if (table === 'app_users') result = url.searchParams.has('id') ? users[0] : users
    else if (table === 'tickets') result = tickets
    else if (table === 'ticket_tasks') result = [{ id: 1, ticket_id: ticket, titulo: 'Modelar suporte', responsavel_id: user, status: items[0].status === 'completed' ? 'concluido' : 'pendente' }]
    else if (table === 'maker_events') result = events; else if (table === 'maker_work_items') result = items; else if (table === 'maker_blocks') result = blocks; else if (table === 'maker_availability') result = availability
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(result) })
  })

  const slot = (name, day, period) => page.locator(`section[aria-label="${name}, ${br(day)} · ${period}"]`)
  const side = page.getByRole('complementary', { name: 'Etapas a agendar' })
  const notice = page.locator('.board-notice')
  // HTML5 drag and drop: press, move in steps so dragstart/dragover fire, release on the target.
  const drag = async (from, to) => {
    await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 }); await page.waitForTimeout(80)
    await to.scrollIntoViewIfNeeded(); const b = await to.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 8 }); await page.waitForTimeout(80)
    await page.mouse.move(b.x + b.width / 2, b.y + 24, { steps: 2 }); await page.mouse.up()
  }

  await page.goto(base + '/planejamento'); await page.getByRole('heading', { name: 'Planejamento de equipe', exact: true }).waitFor()
  // Bloco vencido de outra semana continua evidente; lista mostra só o saldo sem reserva.
  await side.getByText('Precisa remanejar · 1').waitFor()
  await side.getByText('Faltam agendar 4h').waitFor()
  assert.equal(await side.getByText('Montar kit').count(), 0, 'etapa totalmente reservada não fica na lista')
  await page.getByRole('button', { name: 'Próxima semana' }).click()
  await slot('Felipe', week(2), 'manhã').getByText('Aula: Aula de teste').waitFor() // ocupação fixa
  assert.equal(await slot('Felipe', week(2), 'tarde').locator('.board-fixed').count(), 0, 'aula que termina ao meio-dia não ocupa a tarde')
  await page.screenshot({ path: shot('ctp-planning-desktop.png'), fullPage: true })

  // 1. Arrastar etapa -> pergunta a duração -> reserva parcial mantém o saldo na lista.
  await drag(side.getByRole('button', { name: /Imprimir peças/ }), slot('Felipe', week(0), 'manhã'))
  const dialog = page.getByRole('dialog'); await dialog.getByRole('heading', { name: 'Quanto tempo reservar?' }).waitFor()
  await dialog.getByLabel('Duração do bloco · horas').fill('2'); await dialog.getByRole('button', { name: 'Reservar' }).click()
  await notice.filter({ hasText: 'Reserva gravada' }).waitFor(); await notice.filter({ hasText: 'Ainda faltam agendar 2h' }).waitFor()
  await side.getByText('Faltam agendar 2h').waitFor()
  assert(calls.some(c => c.table === 'maker_blocks' && c.body.minutes === 120 && c.body.user_id === user && c.body.day === week(0)))
  // 2. Segundo cartão no mesmo período; etapa sai da lista quando tudo está reservado.
  await drag(side.getByRole('button', { name: /Imprimir peças/ }), slot('Felipe', week(0), 'manhã'))
  await dialog.getByRole('button', { name: 'Reservar' }).click(); await notice.filter({ hasText: 'Reserva gravada' }).waitFor()
  assert.equal(await slot('Felipe', week(0), 'manhã').locator('.board-card').count(), 2)
  await slot('Felipe', week(0), 'manhã').getByText('0h livres').waitFor()
  assert.equal(await side.getByText('Imprimir peças').count(), 0)

  // 3. Sem arrastar: detalhes -> mover. Destinos inválidos explicam o motivo.
  await side.getByRole('button', { name: /Modelar suporte/ }).click()
  await dialog.getByText('Precisa remanejar.').waitFor()
  await dialog.getByRole('button', { name: 'Mover para outro período' }).click()
  await slot('Felipe', week(0), 'manhã').getByText('Sem horas livres').waitFor()        // capacidade
  await slot('Felipe', week(2), 'manhã').getByText('Ocupado: Aula de teste').waitFor() // bloqueio por evento
  await slot('Manu', week(0), 'tarde').getByText('Outro responsável').waitFor()        // não troca responsável
  assert.equal(await slot('Felipe', week(0), 'manhã').getByRole('button', { name: 'Colocar aqui' }).count(), 0)
  // Bloco vencido: confirma o restante e a nova duração.
  await slot('Felipe', week(1), 'tarde').getByRole('button', { name: 'Colocar aqui' }).click()
  await dialog.getByRole('heading', { name: 'Quanto falta e quanto reservar agora?' }).waitFor()
  await dialog.getByRole('button', { name: 'Remanejar' }).click(); await notice.filter({ hasText: 'Remanejado: Modelar suporte' }).waitFor()
  assert(calls.some(c => c.table === 'maker_continue_block' && c.body.block_id === 'b1' && c.body.new_day === week(1) && c.body.remaining === 180 && c.body.new_minutes === 180))
  assert.equal(await side.getByText(/Precisa remanejar/).count(), 0)

  // 4. Arrastar bloco em dia: remaneja direto, mesma duração, com histórico.
  const moved = slot('Felipe', week(1), 'tarde').locator('.board-card', { hasText: 'Modelar suporte' })
  await drag(moved, slot('Felipe', week(3), 'manhã')); await notice.filter({ hasText: 'Remanejado: Modelar suporte' }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 0, 'sem formulário quando não há pendência')
  const move = calls.filter(c => c.table === 'maker_continue_block').at(-1)
  assert.deepEqual([move.body.new_day, move.body.new_period, move.body.new_minutes, move.body.remaining], [week(3), 'manha', 180, 180])
  await slot('Felipe', week(3), 'manhã').locator('.board-card', { hasText: 'Modelar suporte' }).click()
  await dialog.getByText(/remanejado de/).waitFor(); await dialog.getByRole('button', { name: 'Fechar' }).click()

  // 5. Banco recusa: nada sai do lugar e o motivo aparece.
  failNext = 'O trabalho excede o tempo disponível neste período.'
  await drag(slot('Felipe', week(3), 'manhã').locator('.board-card', { hasText: 'Modelar suporte' }), slot('Felipe', week(4), 'manhã'))
  await page.getByRole('alert').filter({ hasText: 'Não foi gravado: O trabalho excede o tempo disponível neste período.' }).waitFor()
  await page.getByRole('alert').filter({ hasText: `O bloco continua em ${br(week(3))} · manhã` }).waitFor()
  assert.equal(await slot('Felipe', week(3), 'manhã').locator('.board-card', { hasText: 'Modelar suporte' }).count(), 1)
  assert.equal(await slot('Felipe', week(4), 'manhã').locator('.board-card').count(), 0)
  assert.equal(await notice.filter({ hasText: 'Remanejado' }).count(), 0, 'não anuncia sucesso sem confirmação')

  // 6. Decidir depois mantém o alerta; concluir etapa não conclui a demanda.
  await slot('Felipe', week(3), 'manhã').locator('.board-card', { hasText: 'Modelar suporte' }).click()
  await dialog.getByRole('button', { name: 'Continuar depois' }).click(); await dialog.getByRole('heading', { name: 'Quanto falta e quando vai continuar?' }).waitFor()
  await dialog.getByRole('button', { name: 'Decidir depois · manter alerta' }).click(); await side.getByText('Precisa remanejar · 1').waitFor()
  assert(calls.some(c => c.table === 'maker_continue_block' && c.body.new_day === null))
  await side.getByRole('button', { name: /Modelar suporte/ }).click(); await dialog.getByRole('button', { name: 'Concluir etapa' }).click()
  await notice.filter({ hasText: 'Etapa concluída: Modelar suporte' }).waitFor()
  await slot('Felipe', week(3), 'manhã').getByText('Etapa concluída').waitFor(); assert.equal(tickets[0].status, 'em_producao')

  assert(confirms.some(m => /usa 1h da folga protegida de Felipe/.test(m)), 'reservar dentro da folga pede confirmação com as horas')

  // 7. Planejamento assistido: nada é gravado antes de aceitar; recusa do banco não grava nada.
  await page.getByText(/Fora do planejamento · \d+/).click()
  await page.getByRole('button', { name: 'Planejar demanda inteira' }).click()
  await dialog.getByRole('heading', { name: /Planejar demanda inteira: Braço robótico/ }).waitFor()
  await dialog.getByText('Informe o responsável e os valores acima').waitFor()
  await dialog.getByLabel('Trabalho previsto · horas').fill('6')
  const proposal = dialog.getByRole('region', { name: 'Proposta' })
  const openDetails = async name => { const d = proposal.locator('details', { hasText: name }).first(); if ((await d.getAttribute('open')) === null) await d.locator('summary').click() }
  assert.equal(await dialog.getByLabel(/Permitir que esta proposta use a folga protegida/).isChecked(), false, 'a folga protegida nunca vem autorizada')
  await proposal.locator('.planner-headline b').first().waitFor(); assert.match(await proposal.locator('.planner-headline span').first().innerText(), /de sobra|No dia do prazo|depois do prazo/)
  await proposal.getByText('Arredondado para blocos de 15 minutos: você informou 6h de trabalho e 1h12 de proteção; a reserva usa 6h e 1h15').waitFor()
  await openDetails('Comparar cenários')
  assert.deepEqual(await proposal.locator('.planner-table tbody tr td:first-child').allInnerTexts(), ['Só a estimativa', 'Com a margem', 'Com a margem e a folga'])
  await openDetails('Premissas'); await proposal.getByText('Tempo de máquina, materiais e dependências').waitFor()
  await proposal.getByText('Nenhum feriado ou ausência cadastrado').waitFor()
  assert.equal(calls.filter(c => c.table === 'maker_accept_plan').length, 0, 'a proposta não grava nada')
  await dialog.getByLabel('Não sei ainda').check()
  await proposal.locator('.planner-headline', { hasText: 'Sem previsão' }).waitFor(); assert.equal(await proposal.locator('.planner-table').count(), 0)
  await dialog.getByLabel('Tenho uma faixa').check(); await dialog.getByLabel('Cenário menor · horas').fill('4'); await dialog.getByLabel('Cenário maior · horas').fill('7')
  assert.equal(await proposal.locator('.planner-headline').count(), 2, 'duas previsões lado a lado'); await openDetails('Comparar cenários')
  assert.deepEqual(await proposal.locator('.planner-table tbody tr td:first-child').allInnerTexts(), ['Se for o cenário menor', 'Se for o cenário maior'])
  await proposal.getByText('a menor não é um compromisso de entrega').waitFor()
  await dialog.getByLabel(/Permitir que esta proposta use a folga protegida/).check(); await proposal.locator('.planner-slack-used').getByText(/Esta proposta usa .+ da folga protegida/).waitFor()
  await dialog.getByLabel(/Permitir que esta proposta use a folga protegida/).uncheck(); await page.screenshot({ path: shot('ctp-planner.png') })
  failNext = 'O trabalho excede o tempo disponível neste período.'
  await dialog.getByRole('button', { name: 'Aceitar proposta' }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Não foi gravado: O trabalho excede o tempo disponível neste período. Nada foi reservado.' }).waitFor()
  assert.equal(items.some(i => i.ticket_id === ticket2), false)
  await dialog.getByRole('button', { name: 'Aceitar proposta' }).click()
  await notice.filter({ hasText: 'Proposta aceita: Braço robótico, 7h reservadas' }).filter({ hasText: 'O prazo oficial não foi alterado' }).waitFor()
  const accepted = calls.filter(c => c.table === 'maker_accept_plan' && !c.failed).at(-1).body.plan
  assert.deepEqual([accepted.mode, accepted.scope, accepted.ticket_id, accepted.assignee_id, accepted.work_minutes, accepted.protection_minutes, accepted.low_minutes, accepted.high_minutes], ['faixa', 'demanda', ticket2, other, 240, 180, 240, 420])
  assert.equal(accepted.blocks.reduce((n, b) => n + b.minutes, 0), 420); assert.equal(accepted.blocks.filter(b => b.purpose === 'protecao').reduce((n, b) => n + b.minutes, 0), 180)
  assert.ok(!accepted.use_slack, 'a proposta não entra na folga sem confirmação')
  assert.equal(tickets[1].data_entrega, week(18))

  await page.goto(base + '/eventos'); await page.getByRole('button', { name: 'Novo evento', exact: true }).click(); const form = page.getByRole('dialog')
  await form.locator('[name=title]').fill('Workshop novo'); await form.locator('[name=day]').fill(week(3)); await form.locator('[name=start]').fill('14:00'); await form.locator('[name=end]').fill('16:00'); await form.locator('[name=participants]').first().check(); await form.locator('[name=preparation]').fill('Testar atividade\nSeparar materiais')
  await form.getByRole('button', { name: 'Cadastrar evento' }).click(); await form.waitFor({ state: 'hidden' }); assert(calls.some(c => c.table === 'maker_create_event' && c.body.preparations.length === 2))
  await page.getByRole('button', { name: 'Semana', exact: true }).click(); await page.screenshot({ path: shot('ctp-events-desktop.png'), fullPage: true })
  // Celular: sem arrastar. Espera a agenda carregar antes de cada captura.
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(base + '/planejamento')
  await page.locator('.board-slot').first().waitFor(); await page.getByRole('button', { name: 'Próxima semana' }).click(); await page.locator('.board-card').first().waitFor()
  await page.screenshot({ path: shot('ctp-planning-mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'sem rolagem horizontal da página no celular')
  await page.locator('.board-card', { hasText: 'Imprimir peças' }).first().click(); await dialog.getByRole('button', { name: 'Mover para outro período' }).waitFor()
  await page.screenshot({ path: shot('ctp-planning-mobile-detalhes.png') })
  await dialog.getByRole('button', { name: 'Mover para outro período' }).click(); await page.getByRole('button', { name: 'Colocar aqui' }).first().waitFor()
  await page.screenshot({ path: shot('ctp-planning-mobile-mover.png'), fullPage: true })
  await page.getByRole('button', { name: 'Cancelar (Esc)' }).click()
  await page.goto(base + '/'); await page.getByText('Capacidade da equipe').waitFor(); await page.locator('.dash-kpi').first().waitFor(); await page.waitForTimeout(800)
  await page.screenshot({ path: shot('ctp-dashboard-mobile.png'), fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'dashboard sem rolagem horizontal no celular')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(base + '/'); await page.getByRole('heading', { name: 'Dashboard do Espaço Maker' }).waitFor(); await page.getByText('Capacidade da equipe').waitFor()
  await page.goto(base + '/relatorios'); await page.getByRole('navigation', { name: 'Visões de relatórios' }).waitFor(); assert(await page.getByRole('navigation', { name: 'Visões de relatórios' }).getByRole('link').count() === 3)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('OK: reserva parcial por arraste, vários cartões no período, destinos inválidos (capacidade, evento, outro responsável), bloco vencido, remanejamento direto com histórico, falha de gravação sem mover, decidir depois, concluir etapa sem mudar a demanda, confirmação para usar a folga, planejamento assistido (três caminhos, recusa sem gravar, aceite), eventos, dashboard e relatórios.')
  console.log('Capturas em', os.tmpdir())
  await browser.close(); await vite.close()
})().catch(e => { console.error(e); process.exit(1) })
