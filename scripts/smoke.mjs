// UI smoke test: starts Speedrun with a throwaway profile and walks the main paths in the real timer,
// through Chrome DevTools Protocol. No extra dependencies. Run with `npm run smoke` (macOS, after a build).
//
// It checks what the unit tests can't: that the timer actually renders and behaves. Folded and open
// layout, adding tasks and subtasks, Done moving on, ending a session, and the summary's look.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'speedrun-smoke-'));
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboarded: true, countIn: false, countInDefaulted: true, sounds: false }));

const electron = (await import('electron')).default;
const app = spawn(electron, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✖'} ${name}${ok || !detail ? '' : ` (${detail})`}`);
  if (!ok) failures++;
};

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = pages.find((p) => p.title === 'Speedrun timer');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await wait(250);
  }
  throw new Error('the timer never showed up');
}

try {
  const ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    pending.get(d.id)?.(d);
  };
  /** Runs an expression in the timer and returns its value. */
  const run = (expression) =>
    new Promise((resolve, reject) => {
      pending.set(++id, (d) => (d.result?.exceptionDetails ? reject(new Error(d.result.exceptionDetails.exception?.description)) : resolve(d.result?.result?.value)));
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true } }));
    });
  /** A real mouse event (it also makes pointer events), in the timer's CSS pixels. */
  const mouse = (type, x, y) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      ws.send(JSON.stringify({ id, method: 'Input.dispatchMouseEvent', params: { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 } }));
    });
  const dragFrom = async (from, to) => {
    await mouse('mouseMoved', from.x, from.y);
    await mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await mouse('mouseReleased', to.x, to.y);
    await wait(400);
  };
  const act = (a) => run(`await window.speedrun.act(${JSON.stringify(a)}); await new Promise(r => setTimeout(r, 300));`);
  const state = () => run('return await window.speedrun.getState();');
  const open = () => run(`if (document.getElementById('more').hidden) { document.getElementById('face').dispatchEvent(new MouseEvent('mousedown', { button: 0, screenX: 5, screenY: 5 })); window.dispatchEvent(new MouseEvent('mouseup')); } await new Promise(r => setTimeout(r, 300));`);
  await wait(800);

  check('starts with an empty timer', (await run(`return document.getElementById('task').textContent`)).includes('first task'));

  await act({ type: 'import', text: '- Page\n  - Hero 20m\n  - Pricing 10m\n- Emails 15m' });
  let s = await state();
  await act({ type: 'start', id: s.run.tasks[1].id });
  await wait(1200);
  s = await state();
  check('the clock runs', s.run.activeSince !== undefined && (await run(`return document.getElementById('hms').textContent`)) !== '0:00:00');

  const y = (id) => `document.getElementById('${id}').getBoundingClientRect().top`;
  check('folded: clock, then task', await run(`return ${y('hms')} < ${y('task')}`));
  check('folded: nothing else (no group or session line)', await run(`return ['group', 'session'].every((id) => getComputedStyle(document.getElementById(id)).display === 'none')`));

  await open();
  check('opens on click', await run(`return !document.getElementById('more').hidden`));
  check('open: group and session lines show', await run(`return ['group', 'session'].every((id) => getComputedStyle(document.getElementById(id)).display !== 'none')`));
  check('open: task, then session', await run(`return ${y('task')} < ${y('sessionTime')}`));

  // Drag Emails by its handle onto the middle of Page: it becomes Page's subtask.
  s = await state();
  const rect = (sel) => run(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };`);
  const emailsId = s.run.tasks.find((t) => t.title === 'Emails').id;
  const pageId = s.run.tasks.find((t) => t.title === 'Page').id;
  await run(`document.querySelector('.list li[data-id="${emailsId}"]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  const handle = await rect(`.list li[data-id="${emailsId}"] .handle`);
  const page = await rect(`.list li[data-id="${pageId}"]`);
  await dragFrom(handle, { x: page.x, y: page.y });
  s = await state();
  check('drag onto a task makes it a subtask', s.run.tasks.find((t) => t.title === 'Emails').parentId === pageId);
  const page2 = await rect(`.list li[data-id="${pageId}"]`);
  const handle2 = await rect(`.list li[data-id="${emailsId}"] .handle`);
  await dragFrom(handle2, { x: page2.x, y: page2.y - page2.h * 0.4 });
  s = await state();
  check('drag onto the top of a task puts it above, as a task', !s.run.tasks.find((t) => t.title === 'Emails').parentId && s.run.tasks[0].title === 'Emails');

  // The right edge makes the open timer wider; the text keeps its size.
  const before = await run(`return { w: document.getElementById('panel').offsetWidth, f: getComputedStyle(document.getElementById('hms')).fontSize }`);
  const edge = await rect('.edge.right');
  await dragFrom(edge, { x: edge.x + 80, y: edge.y });
  await wait(300);
  const after = await run(`return { w: document.getElementById('panel').offsetWidth, f: getComputedStyle(document.getElementById('hms')).fontSize }`);
  check('the side edge widens the timer, text stays the same size', after.w > before.w + 40 && after.f === before.f, `${before.w}→${after.w}`);

  await run(`const i = document.getElementById('addInput'); i.value = 'Invoices 10m'; document.getElementById('addForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));`);
  s = await state();
  check('a new task goes at the end', s.run.tasks.at(-1).title === 'Invoices' && !s.run.tasks.at(-1).parentId);

  await run(`const i = document.getElementById('addInput'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); i.value = 'Receipts 5m'; document.getElementById('addForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));`);
  s = await state();
  const last = s.run.tasks.at(-1);
  check('Tab in the add field makes a subtask', last.title === 'Receipts' && s.run.tasks.find((t) => t.id === last.parentId)?.title === 'Invoices');

  await act({ type: 'split' });
  s = await state();
  // The next task is the first open one in your order (Emails, which the drag above put on top).
  const firstOpen = s.run.tasks.find((t) => !t.done && !s.run.tasks.some((c) => c.parentId === t.id));
  check('Done moves on to the next task', s.run.tasks.find((t) => t.title === 'Hero').done && s.run.activeTaskId === firstOpen?.id);

  for (let i = 0; i < 4; i++) await act({ type: 'split' });
  s = await state();
  check('finishing every task keeps a plain session open', Boolean(s.run) && !s.finished);

  await act({ type: 'endRun' });
  s = await state();
  check('End session shows the summary', Boolean(s.finished) && (await run(`return !document.getElementById('summary').hidden`)));
  check('summary: hide and quit are there', await run(`return document.querySelectorAll('#summary [data-win]').length === 2`));
  check('summary: no box behind the result', await run(`return getComputedStyle(document.getElementById('result')).backgroundColor === 'rgba(0, 0, 0, 0)'`));

  ws.close();
} catch (err) {
  console.log('✖', err.message);
  failures++;
} finally {
  app.kill();
  await wait(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} failed` : '\nAll good');
process.exit(failures ? 1 : 0);
