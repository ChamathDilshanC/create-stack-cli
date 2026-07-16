import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 text-center text-slate-100">
      <h1 className="text-3xl font-bold tracking-tight">React</h1>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        className="rounded-lg bg-cyan-600 px-5 py-2.5 font-medium text-white transition hover:bg-cyan-500"
      >
        count is {count}
      </button>
      <p className="text-sm text-slate-400">
        Edit <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">src/App.jsx</code> and save to test HMR.
      </p>
    </main>
  );
}

export default App;
