import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp } from "../server/app";
import { ImageSearch } from "../server/images";

/** A fake Wikimedia: one search answer, and image bytes for upload.wikimedia.org. */
function fakeCommons(pages: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://commons.wikimedia.org/")) {
      return Response.json({
        query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), { index: i, ...p }])) },
      });
    }
    if (url.startsWith("https://upload.wikimedia.org/")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const page = (title: string, license: string, url = "https://upload.wikimedia.org/a/b/c.jpg", mime = "image/jpeg") => ({
  title,
  imageinfo: [
    {
      thumburl: url,
      mime,
      thumbwidth: 800,
      thumbheight: 600,
      extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Asha &amp; Co</a>' } },
    },
  ],
});

describe("ImageSearch", () => {
  test("takes the first freely licensed, safe picture and credits it", async () => {
    const { fetcher } = fakeCommons([
      page("File:Ludo board.jpg", "All rights reserved"),
      page("File:Nude ludo.jpg", "CC BY-SA 4.0"),
      page("File:Ludo elsewhere.jpg", "CC BY 4.0", "https://evil.example/x.jpg"),
      page("File:Ludo_game.jpg", "CC BY-SA 4.0"),
    ]);
    const search = new ImageSearch(fetcher);
    const hit = await search.search("ludo dice");
    expect(hit).toMatchObject({
      title: "Ludo game",
      credit: "Asha & Co, CC BY-SA 4.0, via Wikimedia Commons",
      width: 800,
    });
    const file = await search.file(hit?.id ?? "");
    expect(file?.headers.get("content-type")).toBe("image/jpeg");
    expect(await search.file("0".repeat(20))).toBeNull();
  });

  test("refuses unsafe searches without asking Wikimedia", async () => {
    const { fetcher, calls } = fakeCommons([]);
    expect(await new ImageSearch(fetcher).search("naked mole rat")).toBeNull();
    expect(calls.length).toBe(0);
  });
});

describe("image routes", () => {
  let server: ReturnType<typeof startApp>;
  beforeAll(() => {
    const { fetcher } = fakeCommons([page("File:Cricket pitch.jpg", "CC0")]);
    server = startApp({
      host: "127.0.0.1",
      port: 0,
      createGrant: null,
      locate: null,
      sessionLimit: 3,
      sessionWindowMs: 60_000,
      images: new ImageSearch(fetcher),
      dailyImageLimit: 2,
    });
  });
  afterAll(() => server.stop(true));
  const http = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

  test("search, then fetch the picture by its id", async () => {
    const res = await http("/api/images/search?q=cricket%20pitch");
    const { image } = (await res.json()) as { image: { id: string; title: string } };
    expect(image.title).toBe("Cricket pitch");
    const file = await http(`/api/images/${image.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toContain("max-age=86400");
  });

  test("bad ids, empty searches, other sites and the daily cap", async () => {
    expect((await http("/api/images/not-an-id")).status).toBe(404);
    expect((await http("/api/images/search?q=")).status).toBe(400);
    expect((await http("/api/images/search?q=dice", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    // The first test used one of the two searches allowed today.
    expect((await http("/api/images/search?q=dice")).status).toBe(200);
    expect((await http("/api/images/search?q=dice")).status).toBe(429);
  });
});
