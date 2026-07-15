import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

let count = 0;

app.innerHTML = `
  <main class="app">
    <h1>Vanilla + TypeScript</h1>
    <button id="counter" type="button"></button>
    <p>Edit <code>src/main.ts</code> and save to test HMR.</p>
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
