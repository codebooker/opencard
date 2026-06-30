import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { config } from "./config";
import { cardsRouter } from "./routes/cards";
import { adminRouter } from "./routes/admin";
import { scimRouter } from "./routes/scim";
import { selfRouter } from "./routes/selfservice";
import { apiRouter } from "./routes/api";
import { previewRouter } from "./routes/preview";
import { uploadDir } from "./upload";

const app = express();
app.set("trust proxy", true);

// SCIM sends application/scim+json; admin forms send urlencoded; beacons send text/plain.
app.use(express.json({ type: ["application/json", "application/scim+json"], limit: "1mb" }));
app.use(express.text({ type: ["text/plain"], limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static assets (styles.css). Works in dev (src/public) and prod (dist/public).
app.use(express.static(path.join(__dirname, "public")));

// Uploaded logos/photos (persistent volume in Docker).
app.use(
  "/uploads",
  express.static(uploadDir, {
    maxAge: "7d",
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:");
    },
  })
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.redirect("/admin"));

app.use("/scim/v2", scimRouter);
app.use("/api/v1", apiRouter);
app.use("/preview", previewRouter);
app.use("/admin", adminRouter);
app.use("/me", selfRouter);
app.use("/c", cardsRouter);

app.use((_req, res) => res.status(404).send("Not found"));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`OpenCard listening on ${config.baseUrl} (port ${config.port})`);
});
