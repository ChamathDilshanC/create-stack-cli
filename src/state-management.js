import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord, jsSrcRoot, registerNextProvider, wrapViteReactRoot } from './scaffold-utils.js';
import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/* ------------------------------------------------------------------ */
/* Zustand — no provider needed, just a store hook                     */
/* ------------------------------------------------------------------ */

const zustandStore = (isTs) => `import { create } from 'zustand';
${isTs
  ? `
interface CounterState {
  count: number;
  increment: () => void;
  reset: () => void;
}
`
  : ''}
export const useCounterStore = create${isTs ? '<CounterState>()' : ''}((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  reset: () => set({ count: 0 }),
}));
`;

async function setupZustand(options, warnings) {
  const { targetDir, language, framework } = options;
  const isTs = language === 'ts';

  await installOrRecord({ options, warnings, packages: ['zustand'], floors: { zustand: '^5.0.0' }, dev: false, label: 'Zustand' });
  await fs.outputFile(path.join(targetDir, jsSrcRoot(framework), 'store', `useCounterStore.${isTs ? 'ts' : 'js'}`), zustandStore(isTs));
}

/* ------------------------------------------------------------------ */
/* Jotai — no provider needed either (atoms work standalone)           */
/* ------------------------------------------------------------------ */

const JOTAI_ATOMS = `import { atom } from 'jotai';

export const countAtom = atom(0);
`;

async function setupJotai(options, warnings) {
  const { targetDir, language, framework } = options;

  await installOrRecord({ options, warnings, packages: ['jotai'], floors: { jotai: '^2.10.0' }, dev: false, label: 'Jotai' });
  await fs.outputFile(path.join(targetDir, jsSrcRoot(framework), 'store', `atoms.${language === 'ts' ? 'ts' : 'js'}`), JOTAI_ATOMS);
}

/* ------------------------------------------------------------------ */
/* Redux Toolkit — needs a <Provider store={store}> around the app     */
/* ------------------------------------------------------------------ */

const counterSlice = (isTs) => `import { createSlice${isTs ? ', type PayloadAction' : ''} } from '@reduxjs/toolkit';
${isTs
  ? `
interface CounterState {
  value: number;
}
`
  : ''}
const initialState${isTs ? ': CounterState' : ''} = { value: 0 };

export const counterSlice = createSlice({
  name: 'counter',
  initialState,
  reducers: {
    increment: (state) => {
      state.value += 1;
    },
    incrementBy: (state, action${isTs ? ': PayloadAction<number>' : ''}) => {
      state.value += action.payload;
    },
    reset: (state) => {
      state.value = 0;
    },
  },
});

export const { increment, incrementBy, reset } = counterSlice.actions;
export default counterSlice.reducer;
`;

const reduxStore = (isTs) => `import { configureStore } from '@reduxjs/toolkit';
import counterReducer from './counterSlice';

export const store = configureStore({
  reducer: {
    counter: counterReducer,
  },
});
${isTs
  ? `
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
`
  : ''}`;

async function setupReduxToolkit(options, warnings) {
  const { targetDir, language, framework } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';
  const storeDir = path.join(jsSrcRoot(framework), 'store');

  await installOrRecord({
    options,
    warnings,
    packages: ['@reduxjs/toolkit', 'react-redux'],
    floors: { '@reduxjs/toolkit': '^2.3.0', 'react-redux': '^9.1.0' },
    dev: false,
    label: 'Redux Toolkit',
  });

  await fs.outputFile(path.join(targetDir, storeDir, `store.${ext}`), reduxStore(isTs));
  await fs.outputFile(path.join(targetDir, storeDir, `counterSlice.${ext}`), counterSlice(isTs));

  if (framework === 'next') {
    // Next.js's App Router has no src/ (jsSrcRoot returns '' for it) — its
    // "@/*" tsconfig path alias maps straight to "./*", so "@/store/store"
    // and the plain storeDir it was written to line up either way.
    await registerNextProvider(targetDir, isTs, {
      importLines: ["import { Provider } from 'react-redux';", "import { store } from '@/store/store';"],
      open: '<Provider store={store}>',
      close: '</Provider>',
    });
    return;
  }

  const wired = await wrapViteReactRoot(targetDir, isTs, {
    importLine: `import { Provider } from 'react-redux';\nimport { store } from './store/store.${ext}';`,
    open: '<Provider store={store}>',
    close: '</Provider>',
  });
  if (!wired) {
    warnings.push(`Redux Toolkit's store was generated (${storeDir}/), but src/main.${ext} could not be auto-wrapped in <Provider> — wrap <App /> in it yourself.`);
  }
}

/* ------------------------------------------------------------------ */
/* Pinia — Vue's own official store; needs app.use(createPinia())      */
/* ------------------------------------------------------------------ */

const piniaCounterStore = (isTs) => `import { defineStore } from 'pinia';

export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
  actions: {
    increment() {
      this.count++;
    },
    reset() {
      this.count = 0;
    },
  },
});
`;

/** Vue's Vite template's main.ts is the one-liner `createApp(App).mount('#app')` — chaining `.use(createPinia())` in before `.mount()` is a stable, low-risk literal replace, the same story wrapViteReactRoot's `<App />` replace is for React. */
async function wireVuePinia(targetDir, isTs, warnings) {
  const ext = isTs ? 'ts' : 'js';
  const mainPath = path.join(targetDir, 'src', `main.${ext}`);
  if (!(await fs.pathExists(mainPath))) {
    warnings.push(`Pinia's store was generated (src/store/), but src/main.${ext} could not be found to auto-wire createPinia() — call app.use(createPinia()) yourself.`);
    return;
  }

  let source = await fs.readFile(mainPath, 'utf8');
  if (source.includes('createPinia')) return;
  if (!source.includes('createApp(App).mount(')) {
    warnings.push(`Pinia's store was generated (src/store/), but src/main.${ext} could not be auto-wired — call app.use(createPinia()) on your app instance yourself.`);
    return;
  }

  source = `import { createPinia } from 'pinia';\n${source}`;
  source = source.replace('createApp(App).mount(', 'createApp(App).use(createPinia()).mount(');
  await fs.writeFile(mainPath, source);
}

/** Nuxt's official @pinia/nuxt module auto-imports defineStore/storeToRefs — no provider or main.ts wiring needed, just the module registration. */
async function registerNuxtPiniaModule(targetDir, warnings) {
  const configNames = ['nuxt.config.ts', 'nuxt.config.js'];
  let configPath = null;
  for (const name of configNames) {
    if (await fs.pathExists(path.join(targetDir, name))) {
      configPath = path.join(targetDir, name);
      break;
    }
  }
  if (!configPath) {
    warnings.push('Pinia was installed, but nuxt.config could not be found to register @pinia/nuxt — add it to the `modules` array yourself.');
    return;
  }

  let source = await fs.readFile(configPath, 'utf8');
  if (source.includes('@pinia/nuxt')) return;

  if (/modules\s*:\s*\[/.test(source)) {
    source = source.replace(/modules\s*:\s*\[/, "modules: ['@pinia/nuxt', ");
  } else if (/defineNuxtConfig\(\{/.test(source)) {
    source = source.replace(/defineNuxtConfig\(\{/, "defineNuxtConfig({\n  modules: ['@pinia/nuxt'],");
  } else {
    warnings.push('Pinia was installed, but nuxt.config could not be updated automatically — add \'@pinia/nuxt\' to the `modules` array yourself.');
    return;
  }
  await fs.writeFile(configPath, source);
}

async function setupPinia(options, warnings) {
  const { targetDir, language, framework } = options;
  const isTs = language === 'ts';

  const packages = framework === 'nuxt' ? ['pinia', '@pinia/nuxt'] : ['pinia'];
  await installOrRecord({ options, warnings, packages, floors: { pinia: '^4.0.0', '@pinia/nuxt': '^1.0.0' }, dev: false, label: 'Pinia' });

  const storesDir = framework === 'nuxt' ? 'stores' : path.join('src', 'store');
  await fs.outputFile(path.join(targetDir, storesDir, `counter.${isTs ? 'ts' : 'js'}`), piniaCounterStore(isTs));

  if (framework === 'nuxt') {
    await registerNuxtPiniaModule(targetDir, warnings);
  } else {
    await wireVuePinia(targetDir, isTs, warnings);
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const SETUP_BY_CHOICE = {
  zustand: setupZustand,
  jotai: setupJotai,
  'redux-toolkit': setupReduxToolkit,
  pinia: setupPinia,
};

/** Only called for frameworks prompts.js's stepStateManagement actually asked about (react/next/vue/nuxt) — see supportsUiLayer/STATE_MANAGEMENT_FRAMEWORKS there. */
export async function applyStateManagement(options, warnings) {
  const setup = SETUP_BY_CHOICE[options.stateManagement];
  if (!setup) return;

  const spinner = createSpinner(`Setting up ${options.stateManagement}...`);
  try {
    await setup(options, warnings);
    spinnerSucceed(spinner, `${options.stateManagement} configured.`);
  } catch (err) {
    spinnerFail(spinner, `${options.stateManagement} setup failed.`);
    warnings.push(`${options.stateManagement} could not be fully wired up: ${err.message}`);
  }
}
