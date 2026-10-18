import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The phone needs HTTPS for its camera, so dev runs on the self-signed
// certificate that `bun run setup` creates.
const certFile = ".certs/cert.pem";
const keyFile = ".certs/key.pem";
const https =
  existsSync(certFile) && existsSync(keyFile)
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : undefined;

const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`;
const proxy = {
  "/api": { target: api, xfwd: true },
  "/ws": { target: api, ws: true },
};

const DESCRIPTION =
  "A cute 3D tutor that teaches maths, probability and stats out loud in Hindi, Hinglish or English, on your laptop screen and in AR on your phone.";

/**
 * With SITE_URL set (a public deploy), add what link previews and search
 * engines need absolute URLs for, plus robots.txt and a sitemap.
 */
function publicSite(siteUrl: string | undefined): Plugin {
  const base = siteUrl?.replace(/\/$/, "");
  return {
    name: "mochi-public-site",
    apply: "build",
    transformIndexHtml(_html, ctx) {
      if (!base || ctx.path !== "/index.html") return;
      const meta = (property: string, content: string) => ({
        tag: "meta",
        attrs: property.startsWith("og:") ? { property, content } : { name: property, content },
        injectTo: "head" as const,
      });
      const app = {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "MochiTutor",
        url: `${base}/`,
        description: DESCRIPTION,
        applicationCategory: "EducationalApplication",
        operatingSystem: "Any (Chrome or Safari)",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        sameAs: "https://github.com/NandishwarSingh/MochiTutor",
      };
      return [
        { tag: "link", attrs: { rel: "canonical", href: `${base}/` }, injectTo: "head" },
        meta("og:type", "website"),
        meta("og:site_name", "MochiTutor"),
        meta("og:title", "MochiTutor"),
        meta("og:description", DESCRIPTION),
        meta("og:url", `${base}/`),
        meta("og:image", `${base}/og.jpg`),
        meta("og:image:width", "1200"),
        meta("og:image:height", "630"),
        meta("og:image:alt", "Mochi explaining the probability of rolling a 7 with two dice on a chalkboard"),
        meta("twitter:card", "summary_large_image"),
        { tag: "script", attrs: { type: "application/ld+json" }, children: JSON.stringify(app), injectTo: "head" },
      ];
    },
    generateBundle() {
      if (!base) return;
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url></urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), publicSite(process.env.SITE_URL)],
  define: { __OWN_AVATAR__: JSON.stringify(existsSync("public/avatars/mochi.vrm")) },
  server: { host: true, port: 5173, https, proxy },
  preview: { host: true, port: 4173, https, proxy },
  build: {
    target: "es2022",
    rollupOptions: { input: { board: "index.html", viewer: "viewer/index.html" } },
  },
});
