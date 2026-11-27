const { Builder, By } = require("selenium-webdriver");
const safari = require("selenium-webdriver/safari");
const httpServer = require("http-server");
const { readFileSync } = require("node:fs");

async function openSafari(width, height, release) {
  try {
    return await openSession(width, height, release);
  } catch (error) {
    if (!/ECONNREFUSED/.test(error.message)) throw error;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return openSession(width, height, release);
  }
}

async function openSession(width, height, release) {
  const errors = [];
  const html = readFileSync("index.html", "utf8")
    .replace("<head>", `<head><script>
      window.testErrors = [];
      addEventListener("error", event => testErrors.push(event.message || event.target?.src || "resource error"), true);
      addEventListener("unhandledrejection", event => testErrors.push(String(event.reason)));
      const originalError = console.error.bind(console);
      console.error = (...args) => { testErrors.push(args.join(" ")); originalError(...args); };
      const originalFetch = fetch.bind(window);
      window.fetch = async (...args) => {
        if (args[0] === "https://api.github.com/repos/Bastet-Normal/mindspace/releases/latest") return Response.json(${JSON.stringify(release)});
        return originalFetch(...args);
      };
    </script>`);
  const server = httpServer.createServer({ root: ".", cache: -1, before: [
    (req, res) => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      res.on("finish", () => { if (res.statusCode >= 400 && pathname !== "/favicon.ico") errors.push(res.statusCode + " " + pathname); });
      if (pathname === "/" || pathname === "/index.html") { res.setHeader("Content-Type","text/html; charset=utf-8"); return res.end(html); }
      if (pathname === "/compat-frame") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>body{margin:0}iframe{display:block;border:0}</style>
          <iframe id="compat-view" src="/" width="${width}" height="${height}" title="MindSpace test viewport"></iframe>`);
      }
      res.emit("next");
    }
  ] });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const service = new safari.ServiceBuilder("/usr/bin/safaridriver").build();
  let driver;
  async function close() {
    try { await driver?.quit(); } finally { await service.kill(); server.close(); }
  }
  try {
    driver = await new Builder().disableEnvironmentOverrides().usingServer(await service.start()).forBrowser("safari").build();
    const [dx, dy] = await driver.executeScript("return [outerWidth-innerWidth, outerHeight-innerHeight]");
    await driver.manage().window().setRect({x:0,y:0,width:width+dx,height:height+dy});
    const baseUrl = "http://127.0.0.1:" + server.server.address().port;
    const measured = await driver.executeScript("return [innerWidth, innerHeight]");
    if (measured[0] !== width || measured[1] !== height) {
      await driver.get(baseUrl + "/compat-frame");
      await driver.switchTo().frame(await driver.findElement(By.id("compat-view")));
    } else {
      await driver.get(baseUrl + "/");
    }
    function locator(by, last = false) {
      const all = () => driver.findElements(by);
      const target = async () => (await all()).at(last ? -1 : 0);
      return {
        last: () => locator(by, true),
        count: async () => (await all()).length,
        visible: async () => Boolean(await target()) && (await target()).isDisplayed(),
        async click() {
          const el = await target();
          await driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})", el);
          try {
            await driver.wait(() => driver.executeScript(function(element) {
              const rect = element.getBoundingClientRect();
              return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
            }, el), 5000);
          } catch (cause) {
            const detail = await driver.executeScript(function(element) {
              const rect = element.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              return { route: location.hash, rect: rect.toJSON(), hit: hit?.outerHTML.slice(0, 180), viewport: [innerWidth, innerHeight] };
            }, el);
            throw new Error("Cannot click " + by + " " + JSON.stringify(detail), { cause });
          }
          await el.click();
        },
        text: async () => (await target()).getText(),
        property: async name => (await target()).getProperty(name),
        attribute: async name => driver.executeScript("return arguments[0].getAttribute(arguments[1])", await target(), name),
        evaluate: async fn => driver.executeScript(fn, await target()),
        async fill(text) {
          const element = await target();
          await driver.wait(() => element.isDisplayed(), 5000);
          await element.clear();
          if (text) await element.sendKeys(text);
        }
      };
    }
    return {
      evaluate: fn => driver.executeScript(fn),
      viewportSize: () => driver.executeScript("return {width: innerWidth, height: innerHeight}"),
      locator: css => locator(By.css(css)),
      byText: (text, tag="*") => locator(By.xpath("//body//"+tag+"[normalize-space(.)='"+text+"']")),
      xpath: expression => locator(By.xpath(expression)),
      errors: async () => errors.concat(await driver.executeScript("return window.testErrors")),
      close
    };
  } catch (err) { await close(); throw err; }
}
module.exports = { openSafari };
