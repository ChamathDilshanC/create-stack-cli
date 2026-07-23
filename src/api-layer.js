import path from 'node:path';
import fs from 'fs-extra';

import { appendEnvVars } from './env.js';
import { installOrRecord, jsSrcRoot, registerNextProvider, wrapViteReactRoot } from './scaffold-utils.js';
import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/** Human labels for the "not yet wired" fallback, mirroring auth.js's NOT_YET_WIRED_LABELS. */
const API_LAYER_LABELS = {
  trpc: 'tRPC',
  'graphql-apollo': 'GraphQL (Apollo Client)',
  'graphql-urql': 'GraphQL (URQL)',
};

/* ------------------------------------------------------------------ */
/* tRPC — real wiring only for Next.js (needs both a server and a      */
/* client in the same app; every other frontend/fullstack framework    */
/* here is client-only, so there's no server half to attach it to)     */
/* ------------------------------------------------------------------ */

const TRPC_SERVER = `import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
`;

const TRPC_APP_ROUTER = `import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const appRouter = router({
  hello: publicProcedure.input(z.object({ name: z.string().optional() })).query(({ input }) => {
    return { message: \`Hello \${input.name ?? 'world'}!\` };
  }),
});

export type AppRouter = typeof appRouter;
`;

const TRPC_ROUTE_HANDLER = `import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/server/routers/_app';

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
  });

export { handler as GET, handler as POST };
`;

const TRPC_CLIENT = `import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@/server/routers/_app';

export const trpc = createTRPCReact<AppRouter>();
`;

/**
 * Its own dedicated 'use client' file rather than a static open/close tag
 * through registerNextProvider() directly — the tRPC + TanStack Query
 * client instances have to be created inside the component via useState()
 * (so they're stable across re-renders, not recreated every render), which
 * doesn't fit a plain wrap. This component is what actually gets composed
 * into app/providers.tsx.
 */
const TRPC_PROVIDER_COMPONENT = `'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from '@/trpc/client';

export function TrpcProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: '/api/trpc' })],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
`;

/** Real tRPC wiring only ever runs for framework === 'next' (see applyApiLayer's up-front check) — every path below is rooted straight off targetDir, not jsSrcRoot()-prefixed, matching create-next-app's actual default layout (app/ at the project root, no src/ — see scaffold-utils.js's jsSrcRoot for the full story). */
async function setupTrpc(options, warnings) {
  const { targetDir } = options;

  await installOrRecord({
    options,
    warnings,
    packages: ['@trpc/server', '@trpc/client', '@trpc/react-query', '@tanstack/react-query', 'zod'],
    floors: {
      '@trpc/server': '^11.0.0',
      '@trpc/client': '^11.0.0',
      '@trpc/react-query': '^11.0.0',
      '@tanstack/react-query': '^5.60.0',
      zod: '^3.23.0',
    },
    dev: false,
    label: 'tRPC',
  });

  await fs.outputFile(path.join(targetDir, 'server', 'trpc.ts'), TRPC_SERVER);
  await fs.outputFile(path.join(targetDir, 'server', 'routers', '_app.ts'), TRPC_APP_ROUTER);
  await fs.outputFile(path.join(targetDir, 'app', 'api', 'trpc', '[trpc]', 'route.ts'), TRPC_ROUTE_HANDLER);
  await fs.outputFile(path.join(targetDir, 'trpc', 'client.ts'), TRPC_CLIENT);
  await fs.outputFile(path.join(targetDir, 'app', 'trpc-provider.tsx'), TRPC_PROVIDER_COMPONENT);

  await registerNextProvider(targetDir, true, {
    importLines: ["import { TrpcProvider } from './trpc-provider';"],
    open: '<TrpcProvider>',
    close: '</TrpcProvider>',
  });

  warnings.push('tRPC was wired with one example procedure (server/routers/_app.ts\'s `hello`) — call it from a client component with `trpc.hello.useQuery({ name: "you" })`.');
}

/* ------------------------------------------------------------------ */
/* GraphQL — Apollo Client / URQL (client-only; React and Next.js)     */
/* ------------------------------------------------------------------ */

const GRAPHQL_ENDPOINT_PLACEHOLDER = 'https://api.example.com/graphql';

/** `import.meta.env.VITE_*` (Vite/React) vs `process.env.NEXT_PUBLIC_*` (Next.js) — the two env-var access conventions this CLI's frameworks actually use. */
function graphqlEndpointExpr(framework) {
  return framework === 'next' ? 'process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT' : 'import.meta.env.VITE_GRAPHQL_ENDPOINT';
}

function graphqlEndpointEnvVar(framework) {
  return framework === 'next' ? 'NEXT_PUBLIC_GRAPHQL_ENDPOINT' : 'VITE_GRAPHQL_ENDPOINT';
}

/** Apollo Client 4 dropped the plain `uri` shorthand — ApolloClient now always takes an explicit `link` (an ApolloLink instance; HttpLink is the basic HTTP one), confirmed against the package's own current type definitions. */
const apolloClientFile = (framework) => `import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';

export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: ${graphqlEndpointExpr(framework)} ?? '${GRAPHQL_ENDPOINT_PLACEHOLDER}' }),
  cache: new InMemoryCache(),
});
`;

const urqlClientFile = (framework) => `import { cacheExchange, createClient, fetchExchange } from 'urql';

export const urqlClient = createClient({
  url: ${graphqlEndpointExpr(framework)} ?? '${GRAPHQL_ENDPOINT_PLACEHOLDER}',
  exchanges: [cacheExchange, fetchExchange],
});
`;

async function setupGraphqlClient(options, warnings, kind) {
  const { targetDir, framework, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const isApollo = kind === 'graphql-apollo';
  // Apollo Client 4 added a peer dependency on rxjs (its Observable
  // implementation moved from zen-observable to rxjs) that v3 never needed.
  const packages = isApollo ? ['@apollo/client', 'rxjs', 'graphql'] : ['urql', 'graphql'];
  const floors = isApollo
    ? { '@apollo/client': '^4.0.0', rxjs: '^7.3.0', graphql: '^16.9.0' }
    : { urql: '^5.0.0', graphql: '^16.9.0' };
  await installOrRecord({ options, warnings, packages, floors, dev: false, label: API_LAYER_LABELS[kind] });

  await appendEnvVars(
    targetDir,
    { [graphqlEndpointEnvVar(framework)]: GRAPHQL_ENDPOINT_PLACEHOLDER },
    { [graphqlEndpointEnvVar(framework)]: GRAPHQL_ENDPOINT_PLACEHOLDER }
  );

  const clientContent = isApollo ? apolloClientFile(framework) : urqlClientFile(framework);
  const clientRelPath = path.join(jsSrcRoot(framework), 'lib', `${isApollo ? 'apollo-client' : 'urql-client'}.${ext}`);
  await fs.outputFile(path.join(targetDir, clientRelPath), clientContent);

  const clientImportPath = framework === 'next' ? `@/lib/${isApollo ? 'apollo-client' : 'urql-client'}` : `./lib/${isApollo ? 'apollo-client' : 'urql-client'}.${ext}`;
  const providerArgs = isApollo
    ? {
        // ApolloProvider moved to the @apollo/client/react subpath in v4 —
        // it's no longer a top-level export of @apollo/client itself.
        importLines: [`import { ApolloProvider } from '@apollo/client/react';`, `import { apolloClient } from '${clientImportPath}';`],
        open: '<ApolloProvider client={apolloClient}>',
        close: '</ApolloProvider>',
      }
    : {
        importLines: [`import { Provider as UrqlProvider } from 'urql';`, `import { urqlClient } from '${clientImportPath}';`],
        open: '<UrqlProvider value={urqlClient}>',
        close: '</UrqlProvider>',
      };

  if (framework === 'next') {
    await registerNextProvider(targetDir, isTs, providerArgs);
  } else {
    const wired = await wrapViteReactRoot(targetDir, isTs, {
      importLine: providerArgs.importLines.join('\n'),
      open: providerArgs.open,
      close: providerArgs.close,
    });
    if (!wired) {
      warnings.push(`${API_LAYER_LABELS[kind]}'s client was generated (${path.dirname(clientRelPath)}/), but src/main.${ext} could not be auto-wrapped in its provider — wrap <App /> in it yourself.`);
    }
  }

  warnings.push(`${API_LAYER_LABELS[kind]} was wired against a placeholder endpoint (${graphqlEndpointEnvVar(framework)} in .env) — point it at your real GraphQL API.`);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Only called for frontend/fullstack projects (see prompts.js's
 * supportsUiLayer). Framework/language support is checked up front, before
 * any spinner starts — same order auth.js's applyAuth uses — so the
 * "not yet wired" fallback (every framework except Next.js for tRPC; every
 * framework except React/Next.js for the GraphQL clients) reads as its own
 * warning rather than a spinner claiming something was configured when
 * nothing actually was.
 */
export async function applyApiLayer(options, warnings) {
  if (!options.apiLayer || options.apiLayer === 'none') return;

  const { apiLayer, framework, language } = options;
  const label = API_LAYER_LABELS[apiLayer];

  if (apiLayer === 'trpc') {
    if (framework !== 'next') {
      warnings.push(`tRPC was selected but isn't wired up yet for ${framework} in this CLI — Next.js is the only framework with real tRPC scaffolding so far (it needs both a server and a client in the same app).`);
      return;
    }
    if (language !== 'ts') {
      warnings.push("tRPC was selected, but this CLI's tRPC scaffolding is TypeScript-only (tRPC's own type inference is the entire point) — re-run with TypeScript to get it, or pick a different API layer.");
      return;
    }
  } else if (framework !== 'react' && framework !== 'next') {
    warnings.push(`${label} was selected but isn't wired up yet for ${framework} in this CLI — React and Next.js are the only frameworks with real GraphQL client scaffolding so far.`);
    return;
  }

  const spinner = createSpinner(`Setting up ${label}...`);
  try {
    if (apiLayer === 'trpc') {
      await setupTrpc(options, warnings);
    } else {
      await setupGraphqlClient(options, warnings, apiLayer);
    }
    spinnerSucceed(spinner, `${label} configured.`);
  } catch (err) {
    spinnerFail(spinner, `${label} setup failed.`);
    warnings.push(`${label} could not be fully wired up: ${err.message}`);
  }
}
