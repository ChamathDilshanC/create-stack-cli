/**
 * File contents written by the Tailwind CSS setup step (src/scaffold.js).
 *
 * These are not project templates — the project itself always comes from the
 * official scaffolders (create-vite / Angular CLI). These snippets only replace
 * the starter component and CSS entry so the generated app actually renders
 * Tailwind utility classes out of the box.
 */

/** Tailwind CSS v4 entry — the single import replaces the old @tailwind directives. */
export const TAILWIND_CSS_ENTRY = `@import "tailwindcss";
`;

/** Fresh Vite config used when the template ships without one (vanilla). */
export const VITE_CONFIG_WITH_TAILWIND = `import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss()],
})
`;

/** Tailwind v4 PostCSS config for Angular (the Vite plugin doesn't apply there). */
export const ANGULAR_POSTCSS_CONFIG = `{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
`;

const reactApp = (file) => `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-400">
          create-stack
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">
          React + Tailwind CSS
        </h1>
        <p className="mt-4 text-slate-400">
          Edit{' '}
          <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-cyan-300">
            src/${file}
          </code>{' '}
          and save to reload.
        </p>
        <button
          onClick={() => setCount((c) => c + 1)}
          className="mt-8 rounded-lg bg-cyan-500 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-400 active:scale-95"
        >
          count is {count}
        </button>
      </div>
    </main>
  )
}

export default App
`;

const vueApp = (lang) => `<script setup${lang === 'ts' ? ' lang="ts"' : ''}>
import { ref } from 'vue'

const count = ref(0)
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
    <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-emerald-400">
        create-stack
      </p>
      <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
        Vue + Tailwind CSS
      </h1>
      <p class="mt-4 text-slate-400">
        Edit
        <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-emerald-300">src/App.vue</code>
        and save to reload.
      </p>
      <button
        class="mt-8 rounded-lg bg-emerald-500 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-emerald-400 active:scale-95"
        @click="count++"
      >
        count is {{ count }}
      </button>
    </div>
  </main>
</template>
`;

const vanillaMain = (lang) => `import './style.css'

let count = 0

document.querySelector${lang === 'ts' ? '<HTMLDivElement>' : ''}('#app')${lang === 'ts' ? '!' : ''}.innerHTML = \`
  <main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
    <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
      <p class="text-sm font-semibold uppercase tracking-widest text-amber-400">
        create-stack
      </p>
      <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
        Vite + Tailwind CSS
      </h1>
      <p class="mt-4 text-slate-400">
        Edit
        <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-amber-300">src/main.${lang}</code>
        and save to reload.
      </p>
      <button
        id="counter"
        class="mt-8 rounded-lg bg-amber-500 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-amber-400 active:scale-95"
      >
        count is 0
      </button>
    </div>
  </main>
\`

document.querySelector${lang === 'ts' ? '<HTMLButtonElement>' : ''}('#counter')${lang === 'ts' ? '!' : ''}.addEventListener('click', (event) => {
  count += 1
  ${lang === 'ts' ? '(event.currentTarget as HTMLButtonElement)' : 'event.currentTarget'}.textContent = \`count is \${count}\`
})
`;

/** Kept so the Angular CLI's generated <router-outlet /> keeps working untouched. */
const angularApp = `<main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
  <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
    <p class="text-sm font-semibold uppercase tracking-widest text-rose-400">
      create-stack
    </p>
    <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
      Angular + Tailwind CSS
    </h1>
    <p class="mt-4 text-slate-400">
      Edit
      <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-rose-300">src/app</code>
      and save to reload.
    </p>
  </div>
</main>

<router-outlet />
`;

/**
 * Tailwind-styled starter components, keyed by framework.
 * Each entry lists candidate target files (first existing one wins) and the
 * content to write for a given language.
 */
export const TAILWIND_STARTERS = {
  react: {
    candidates: (lang) => [lang === 'ts' ? 'src/App.tsx' : 'src/App.jsx'],
    content: (lang) => reactApp(lang === 'ts' ? 'App.tsx' : 'App.jsx'),
    // Dead once App no longer imports them — removed to keep the scaffold clean.
    obsolete: ['src/App.css'],
  },
  vue: {
    candidates: () => ['src/App.vue'],
    content: (lang) => vueApp(lang),
    obsolete: ['src/components/HelloWorld.vue'],
  },
  vanilla: {
    candidates: (lang) => [lang === 'ts' ? 'src/main.ts' : 'src/main.js'],
    content: (lang) => vanillaMain(lang),
    obsolete: ['src/counter.js', 'src/counter.ts', 'src/typescript.svg', 'src/javascript.svg'],
  },
  angular: {
    // Angular 20+ generates src/app/app.html; older majors used app.component.html.
    candidates: () => ['src/app/app.html', 'src/app/app.component.html'],
    content: () => angularApp,
    obsolete: [],
  },
};
