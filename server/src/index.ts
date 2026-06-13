import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { httpServer } = createApp(config);

httpServer.listen(config.port, () => {
  console.log(`WithYou server listening on port ${config.port}`);
});
