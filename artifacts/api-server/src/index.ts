import app from "./app";
import { logger } from "./lib/logger";
import { ensureDefaultStoreContent } from "./lib/seedStore";
import { startTelegramBot } from "./lib/telegramBot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await ensureDefaultStoreContent();
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    void startTelegramBot().catch((error: unknown) => {
      logger.error({ err: error }, "Telegram bot startup failed; storefront remains available");
    });
  });
}

void startServer().catch((error: unknown) => {
  logger.error({ err: error }, "Server startup failed");
  process.exit(1);
});
