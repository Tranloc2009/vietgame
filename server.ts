import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { loadServerConfig } from './src/server/config';
import { createServerRuntime } from './src/server/createApp';
import { SqliteMatchStore } from './src/server/db/sqliteStore';

async function bootstrap(): Promise<void> {
  const config = loadServerConfig(process.env);
  const store = new SqliteMatchStore(config.sqliteDbPath);
  const runtime = createServerRuntime(config, store);

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    runtime.app.use(express.static(distDir));
    runtime.app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: runtime.httpServer },
        ws: { server: runtime.httpServer },
      },
      appType: 'spa',
    });
    runtime.app.use(vite.middlewares);
  }

  const bindAddress = process.env.HOST || '0.0.0.0';
  runtime.httpServer.listen(config.port, bindAddress, () => {
    runtime.scheduler.start();
    console.log(
      `[VDN] Server running on http://${bindAddress}:${config.port} (env=${config.appEnv}, db=${config.sqliteDbPath})`
    );
  });

  const shutdown = async () => {
    await runtime.close();
    store.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[VDN] Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

