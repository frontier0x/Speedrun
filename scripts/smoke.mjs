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

  const order = await run(`const f = document.getElementById('face'); const y = (id) => document.getElementById(id).getBoundingClientRect().top; return [y('hms') < y('task'), y('task') < y('sessionTime')];`);
  check('folded: clock, then task, then session', order[0] && order[1]);
  check('folded: no group line', await run(`return getComputedStyle(document.getElementById('group')).display === 'none'`));

  await open();
  check('opens on click', await run(`return !document.getElementById('more').hidden`));
  check('open: the group line shows', await run(`return getComputedStyle(document.getElementById('group')).display !== 'none'`));

  await run(`const i = document.getElementById('addInput'); i.value = 'Invoices 10m'; document.getElementById('addForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));`);
  s = await state();
  check('a new task goes at the end', s.run.tasks.at(-1).title === 'Invoices' && !s.run.tasks.at(-1).parentId);

  await run(`const i = document.getElementById('addInput'); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); i.value = 'Receipts 5m'; document.getElementById('addForm').requestSubmit(); await new Promise(r => setTimeout(r, 300));`);
  s = await state();
  const last = s.run.tasks.at(-1);
  check('Tab in the add field makes a subtask', last.title === 'Receipts' && s.run.tasks.find((t) => t.id === last.parentId)?.title === 'Invoices');

  await act({ type: 'split' });
  s = await state();
  check('Done moves on to the next task', s.run.tasks.find((t) => t.title === 'Hero').done && s.run.tasks.find((t) => t.id === s.run.activeTaskId)?.title === 'Pricing');

  for (let i = 0; i < 4; i++) await act({ type: 'split' });
  s = await state();
  check('finishing every task keeps a plain session open', Boolean(s.run) && !s.finished);

  await act({ type: 'endRun' });
  s = await state();
  check('End session shows the summary', Boolean(s.finished) && (await run(`return !document.getElementById('summary').hidden`)));
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
