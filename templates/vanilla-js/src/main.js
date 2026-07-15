import './style.css';

const app = document.querySelector('#app');

let count = 0;

app.innerHTML = `
  <main class="app">
    <h1>Vanilla JavaScript</h1>
    <button id="counter" type="button"></button>
    <p>Edit <code>src/main.js</code> and save to test HMR.</p>
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
