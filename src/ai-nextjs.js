import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { appendEnvVars } from './env.js';
import { applyQuality } from './quality.js';
import { installOrRecord, mergeScripts, normalizePackageJson } from './scaffold-utils.js';
import { runNextCreate } from './scaffold.js';

/**
 * The chat route — Vercel AI SDK's official Next.js App Router pattern
 * (confirmed against ai@7's own current type definitions: streamText,
 * convertToModelMessages — which is async in this version — and
 * toUIMessageStreamResponse are all still exactly this shape). Streams a
 * real model response; the only thing missing to run it is an API key.
 */
const CHAT_ROUTE = `import { openai } from '@ai-sdk/openai';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: openai('gpt-4o-mini'),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
`;

/** @ai-sdk/react's useChat — its current major dropped the old built-in input/handleSubmit helpers in favor of plain useState + sendMessage({ text }), confirmed against @ai-sdk/react@4's own type definitions. */
const CHAT_PAGE = `'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';

export default function Home() {
  const [input, setInput] = useState('');
  const { messages, sendMessage } = useChat();

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>AI Chat</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {messages.map((message) => (
          <div key={message.id}>
            <strong>{message.role === 'user' ? 'You' : 'Assistant'}:</strong>{' '}
            {message.parts.map((part, i) => (part.type === 'text' ? <span key={i}>{part.text}</span> : null))}
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask something..."
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Send</button>
      </form>
    </main>
  );
}
`;

/**
 * A separate, standalone example from the chat route above — the two SDKs
 * solve overlapping problems (both can call a chat model), so wiring both
 * into the *same* live route would just be confusing about which one is
 * actually in charge. This is LangChain.js's own basic invoke() pattern
 * (confirmed against @langchain/openai@1/@langchain/core@1's current type
 * definitions), meant as a starting point for LangChain-specific needs —
 * chains, agents, retrieval — that the plain AI SDK route doesn't cover.
 */
const LANGCHAIN_EXAMPLE = `import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';

async function main() {
  const model = new ChatOpenAI({ model: 'gpt-4o-mini' });
  const response = await model.invoke([new HumanMessage('Say hello in one short sentence.')]);
  console.log(response.content);
}

main().catch(console.error);
`;

const AI_PACKAGES = ['ai', '@ai-sdk/openai', '@ai-sdk/react', 'zod'];
const AI_FLOORS = { ai: '^7.0.0', '@ai-sdk/openai': '^4.0.0', '@ai-sdk/react': '^4.0.0', zod: '^3.25.0' };
const LANGCHAIN_PACKAGES = ['langchain', '@langchain/core', '@langchain/openai'];
const LANGCHAIN_FLOORS = { langchain: '^1.0.0', '@langchain/core': '^1.0.0', '@langchain/openai': '^1.0.0' };

/**
 * An opinionated preset (Next.js + TypeScript + Tailwind + Vercel AI SDK +
 * LangChain.js), not a wizard-configurable framework like the rest of this
 * CLI's frontend/fullstack options — project type 'ai' sits outside
 * supportsStyling/supportsDatabase/supportsAuth/supportsTesting/
 * supportsUiLayer (see prompts.js), so none of those questions get asked
 * for it; this handler sets its own styling/quality choices directly
 * rather than reading options.styling (which the wizard never actually
 * asked about, and forces to 'none' for every 'ai' framework including
 * this one).
 */
export async function handleAiNextjs(options, warnings) {
  options.styling = 'tailwind';
  options.quality = options.quality && options.quality !== 'none' ? options.quality : 'eslint-prettier';

  await runNextCreate(options);
  await normalizePackageJson(options);
  // runNextCreate already requested --eslint inline when quality wasn't
  // 'none' — same eslintHandledInline story handleFullstack uses for 'next'.
  await applyQuality(options, warnings, { eslintHandledInline: options.quality !== 'none' });

  await installOrRecord({ options, warnings, packages: AI_PACKAGES, floors: AI_FLOORS, dev: false, label: 'Vercel AI SDK' });
  await installOrRecord({ options, warnings, packages: LANGCHAIN_PACKAGES, floors: LANGCHAIN_FLOORS, dev: false, label: 'LangChain.js' });

  const { targetDir } = options;
  await fs.outputFile(path.join(targetDir, 'app', 'api', 'chat', 'route.ts'), CHAT_ROUTE);
  await fs.outputFile(path.join(targetDir, 'app', 'page.tsx'), CHAT_PAGE);
  await fs.outputFile(path.join(targetDir, 'scripts', 'langchain-example.ts'), LANGCHAIN_EXAMPLE);

  // tsx so `npm run langchain:example` (added below) doesn't re-fetch it via
  // npx on every run — same convention Express/Fastify's hand-written
  // package.json already uses for a TS dev script.
  await installOrRecord({ options, warnings, packages: ['tsx'], floors: { tsx: '^4.19.0' }, dev: true, label: 'tsx' });
  await mergeScripts(targetDir, { 'langchain:example': 'tsx scripts/langchain-example.ts' });

  await appendEnvVars(targetDir, { OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OPENAI_API_KEY' }, { OPENAI_API_KEY: 'REPLACE_WITH_YOUR_OPENAI_API_KEY' });

  warnings.push(
    "Set a real OPENAI_API_KEY in .env.local before running — app/api/chat/route.ts (Vercel AI SDK, wired into the home page's chat UI) and scripts/langchain-example.ts (a standalone LangChain.js example — run with `npm run langchain:example`) both need it."
  );
  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'node', buildCommand: 'npm run build', startCommand: 'npm start', port: 3000 });
  }
}
