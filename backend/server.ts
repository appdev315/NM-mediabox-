import "dotenv/config";
import express from "express";
import path from "path";
import apiApp from "./api/index.ts";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 7860;

  // Use the API app for all routes
  app.use(apiApp);

  // In development we just run the API, Vite runs on its own port
  const distPath = path.join(process.cwd(), "../frontend/dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
