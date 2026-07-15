<script setup>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <main class="app">
    <h1>Vue</h1>
    <button
      type="button"
      @click="count++"
    >
      count is {{ count }}
    </button>
    <p>
      Edit <code>src/App.vue</code> and save to test HMR.
    </p>
  </main>
</template>

<style scoped>
.app {
  max-width: 640px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
  font-family: system-ui, sans-serif;
}

button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
}

button:hover {
  border-color: #42b883;
}
</style>
