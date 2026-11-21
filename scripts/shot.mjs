import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUT = process.argv[2] || path.join(ROOT, "shots");
const CHROME =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (url.pathname === "/" || !path.extname(file)) file = path.join(DIST, "index.html");
  if (!file.startsWith(DIST) || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end("nope");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(4399, r));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1240, height: 830, deviceScaleFactor: 2 });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:4399/", { waitUntil: "networkidle0" });
await page.waitForSelector(".empty");
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(OUT, "01-empty.png") });

// start a chat
await page.click("[data-suggest='0']");
await page.click("#send");
await page.waitForFunction(() => document.querySelectorAll(".msg.assistant .body p").length > 0);
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: path.join(OUT, "02-chat.png") });

// a second turn for scrollback texture
await page.type("#input", "And what about memory use?");
await page.keyboard.press("Enter");
await new Promise((r) => setTimeout(r, 2600));
await page.evaluate(() => { const t = document.querySelector("#transcript"); t.scrollTop = 0; });
await page.screenshot({ path: path.join(OUT, "03-thread.png") });

// settings
await page.click("#settings-btn");
await page.waitForSelector(".sheet");
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: path.join(OUT, "04-settings.png") });
await page.keyboard.press("Escape");

// light theme
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("shimondle.settings.v1") || "{}");
  s.theme = "light";
  localStorage.setItem("shimondle.settings.v1", JSON.stringify(s));
});
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: path.join(OUT, "05-light.png") });

console.log(errors.length ? "console errors:\n" + errors.join("\n") : "no console errors");
await browser.close();
server.close();
