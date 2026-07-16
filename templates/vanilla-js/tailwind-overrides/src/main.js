import './style.css';

const app = document.querySelector('#app');

let count = 0;

app.innerHTML = `
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 text-center text-slate-100">
    <h1 class="text-3xl font-bold tracking-tight">Vanilla JavaScript</h1>
    <button id="counter" type="button" class="rounded-lg bg-amber-600 px-5 py-2.5 font-medium text-white transition hover:bg-amber-500"></button>
    <p class="text-sm text-slate-400">Edit <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">src/main.js</code> and save to test HMR.</p>
  </main>
`;

function setCount(value) {
  count = value;
  document.querySelector('#counter').textContent = `count is ${count}`;
}

document
  .querySelector('#counter')
  .addEventListener('click', () => setCount(count + 1));

setCount(0);
