import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "shots");
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

await new Promise((r) => server.listen(4400, r));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--force-device-scale-factor=2"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1240, height: 830, deviceScaleFactor: 2 });

const errors = [];
const failures = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const check = (label, ok) => {
  if (!ok) failures.push(label);
  console.log(`${ok ? "ok" : "FAIL"}  ${label}`);
};
const waitIdle = () => page.waitForFunction(() => !document.body.classList.contains("sending"), { timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto("http://localhost:4400/", { waitUntil: "networkidle0" });
await page.waitForSelector(".empty");

check(
  "thinking toggle visible and on for thinking model",
  await page.$eval("#composer-think", (el) =>
    !el.hidden && el.classList.contains("on") && el.getAttribute("aria-pressed") === "true"),
);
check(
  "thinking model is tagged in the model menu",
  await (async () => {
    await page.click("#composer-model");
    const tagged = await page.$eval('[data-model="qwen3.5:9b"] .mi-tag', (el) => el.textContent === "thinking");
    await page.keyboard.press("Escape");
    return tagged;
  })(),
);

await page.click("[data-suggest='0']");
await page.click("#send");
await page.waitForSelector(".thought-live", { timeout: 4000 });
check("thinking streams into a live block", true);
check("toggle locked while streaming", await page.$eval("#composer-think", (el) => el.disabled));
await sleep(250);
await page.screenshot({ path: path.join(OUT, "06-thinking.png") });

await waitIdle();
await sleep(150);
const first = await page.evaluate(() => ({
  thoughts: document.querySelectorAll(".msg.assistant .thoughts").length,
  thoughtText: document.querySelector(".msg.assistant .thought-body")?.textContent ?? "",
  answer: document.querySelector(".msg.assistant .body")?.textContent ?? "",
  live: document.querySelectorAll(".thought-live").length,
}));
check("thoughts are kept on the finished message", first.thoughts === 1 && first.thoughtText.trim().length > 20);
check("answer still renders under the thoughts", first.answer.trim().length > 20);
check("live reasoning block is cleaned up", first.live === 0);

await page.click(".thoughts summary");
check("thoughts expand on click", await page.$eval(".thoughts", (el) => el.open));
await page.screenshot({ path: path.join(OUT, "07-thoughts.png") });

await page.click("#composer-think");
check(
  "toggle turns off",
  await page.$eval("#composer-think", (el) =>
    !el.classList.contains("on") && el.getAttribute("aria-pressed") === "false"),
);

await page.type("#input", "One more, without the thinking.");
await page.keyboard.press("Enter");
await waitIdle();
await sleep(120);
const second = await page.evaluate(() => ({
  thoughts: document.querySelectorAll(".msg.assistant .thoughts").length,
  msgs: document.querySelectorAll(".msg.assistant").length,
}));
check("no thoughts when thinking is off", second.thoughts === 1 && second.msgs === 2);
check(
  "thinking preference is persisted",
  (await page.evaluate(() => JSON.parse(localStorage.getItem("shimondle.settings.v1") || "{}").thinking)) === false,
);

await page.click("#composer-model");
await page.waitForSelector('[data-model="qwen2.5:7b"]');
await page.click('[data-model="qwen2.5:7b"]');
check("toggle hides for non-thinking models", await page.$eval("#composer-think", (el) => el.hidden));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check("no horizontal overflow", !overflow);
check("no console errors", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall checks passed");
