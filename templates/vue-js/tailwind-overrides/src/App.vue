<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-4 text-center text-slate-100">
    <h1 class="text-3xl font-bold tracking-tight">Vue</h1>
    <button
      type="button"
      class="rounded-lg bg-emerald-600 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-500"
      @click="count++"
    >
      count is {{ count }}
    </button>
    <p class="text-sm text-slate-400">
      Edit <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">src/App.vue</code> and save to test HMR.
    </p>
  </main>
</template>
