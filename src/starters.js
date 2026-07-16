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

const reactApp = (file, styleLabel) => `import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-widest text-cyan-400">
          create-stack
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">
          React + ${styleLabel}
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

const vueApp = (lang, styleLabel, file = 'src/App.vue') => `<script setup${lang === 'ts' ? ' lang="ts"' : ''}>
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
        Vue + ${styleLabel}
      </h1>
      <p class="mt-4 text-slate-400">
        Edit
        <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-emerald-300">${file}</code>
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

const svelteApp = (styleLabel) => `<script lang="ts">
  let count = $state(0)
</script>

<main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
  <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
    <p class="text-sm font-semibold uppercase tracking-widest text-orange-400">
      create-stack
    </p>
    <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
      Svelte + ${styleLabel}
    </h1>
    <p class="mt-4 text-slate-400">
      Edit
      <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-orange-300">src/App.svelte</code>
      and save to reload.
    </p>
    <button
      onclick={() => (count += 1)}
      class="mt-8 rounded-lg bg-orange-500 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-orange-400 active:scale-95"
    >
      count is {count}
    </button>
  </div>
</main>
`;

const solidApp = (styleLabel) => `import { createSignal } from 'solid-js'

function App() {
  const [count, setCount] = createSignal(0)

  return (
    <main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
        <p class="text-sm font-semibold uppercase tracking-widest text-blue-400">
          create-stack
        </p>
        <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
          Solid + ${styleLabel}
        </h1>
        <p class="mt-4 text-slate-400">
          Edit
          <code class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-sm text-blue-300">src/App.tsx</code>
          and save to reload.
        </p>
        <button
          onClick={() => setCount(count() + 1)}
          class="mt-8 rounded-lg bg-blue-500 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-blue-400 active:scale-95"
        >
          count is {count()}
        </button>
      </div>
    </main>
  )
}

export default App
`;

/** Kept so the Angular CLI's generated <router-outlet /> keeps working untouched. */
const angularApp = (styleLabel) => `<main class="flex min-h-screen items-center justify-center bg-slate-950 p-6">
  <div class="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center shadow-2xl">
    <p class="text-sm font-semibold uppercase tracking-widest text-rose-400">
      create-stack
    </p>
    <h1 class="mt-3 text-4xl font-bold tracking-tight text-white">
      Angular + ${styleLabel}
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
 * Styled starter components, keyed by framework. Each entry lists candidate
 * target files (first existing one wins) and the content to write for a
 * given language + styling solution's display name ("Tailwind CSS"/"UnoCSS").
 */
export const TAILWIND_STARTERS = {
  react: {
    candidates: (lang) => [lang === 'ts' ? 'src/App.tsx' : 'src/App.jsx'],
    content: (lang, styleLabel) => reactApp(lang === 'ts' ? 'App.tsx' : 'App.jsx', styleLabel),
    // Dead once App no longer imports them — removed to keep the scaffold clean.
    obsolete: ['src/App.css'],
  },
  vue: {
    candidates: () => ['src/App.vue'],
    content: (lang, styleLabel) => vueApp(lang, styleLabel),
    obsolete: ['src/components/HelloWorld.vue'],
  },
  // Nuxt's app.vue is plain Vue Composition API — the same component works.
  // Nuxt 4's minimal template nests it under app/; Nuxt 3 used the root.
  nuxt: {
    candidates: () => ['app/app.vue', 'app.vue'],
    content: (lang, styleLabel) => vueApp(lang, styleLabel, 'app/app.vue'),
    obsolete: [],
  },
  svelte: {
    candidates: () => ['src/App.svelte'],
    content: (lang, styleLabel) => svelteApp(styleLabel),
    obsolete: ['src/lib/Counter.svelte'],
  },
  solid: {
    candidates: (lang) => [lang === 'ts' ? 'src/App.tsx' : 'src/App.jsx'],
    content: (lang, styleLabel) => solidApp(styleLabel),
    obsolete: ['src/App.css'],
  },
  angular: {
    // Angular 20+ generates src/app/app.html; older majors used app.component.html.
    candidates: () => ['src/app/app.html', 'src/app/app.component.html'],
    content: (lang, styleLabel) => angularApp(styleLabel),
    obsolete: [],
  },
};
