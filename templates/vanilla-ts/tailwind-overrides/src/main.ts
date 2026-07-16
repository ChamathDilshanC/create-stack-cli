import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

let count = 0;

app.innerHTML = `
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 text-center text-slate-100">
    <h1 class="text-3xl font-bold tracking-tight">Vanilla + TypeScript</h1>
    <button id="counter" type="button" class="rounded-lg bg-amber-600 px-5 py-2.5 font-medium text-white transition hover:bg-amber-500"></button>
    <p class="text-sm text-slate-400">Edit <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">src/main.ts</code> and save to test HMR.</p>
  </main>
`;

function setCount(value: number) {
  count = value;
  const button = document.querySelector<HTMLButtonElement>('#counter')!;
  button.textContent = `count is ${count}`;
}

document
  .querySelector<HTMLButtonElement>('#counter')
  ?.addEventListener('click', () => setCount(count + 1));

setCount(0);
