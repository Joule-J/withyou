import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadEnvironmentFiles } from "./env.js";

loadEnvironmentFiles();
const config = loadConfig();
const { httpServer } = createApp(config);

httpServer.listen(config.port, () => {
  console.log(`WithYou server listening on port ${config.port}`);
});
