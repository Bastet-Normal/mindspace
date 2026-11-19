const { Builder, By } = require("selenium-webdriver");
const safari = require("selenium-webdriver/safari");
const httpServer = require("http-server");
const { readFileSync } = require("node:fs");

async function openSafari(width, height, release) {
  const errors = [];
  const html = readFileSync("index.html", "utf8").replace(/https:\/\/cdn.jsdelivr.net\/npm\/ionicons@7.1.0\/[^"]+/g, "/fixture-icons.js")
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
      if (pathname === "/") { res.setHeader("Content-Type","text/html; charset=utf-8"); return res.end(html); }
      if (pathname === "/fixture-icons.js") { res.setHeader("Content-Type","application/javascript"); return res.end(""); }
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
    await driver.get("http://127.0.0.1:"+server.server.address().port+"/");
    function locator(by, last = false) {
      const all = () => driver.findElements(by);
      const target = async () => (await all()).at(last ? -1 : 0);
      return {
        last: () => locator(by, true),
        count: async () => (await all()).length,
        visible: async () => Boolean(await target()) && (await target()).isDisplayed(),
        async click() {
          const el = await target();
          await driver.wait(() => driver.executeScript(function(el) {
            el.scrollIntoView({block:"center",behavior:"instant"});
            const r=el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
          },el),5000);
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
      viewportSize: () => ({width,height}),
      locator: css => locator(By.css(css)),
      byText: (text, tag="*") => locator(By.xpath("//body//"+tag+"[contains(normalize-space(.),'"+text+"') and not(*[contains(normalize-space(.),'"+text+"')])]")),
      xpath: expression => locator(By.xpath(expression)),
      errors: async () => errors.concat(await driver.executeScript("return window.testErrors")),
      close
    };
  } catch (err) { await close(); throw err; }
}
module.exports = { openSafari };
