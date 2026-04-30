import { chromium } from "playwright";
let browserInstance = null;
let browserPromise = null;
export async function getBrowser() {
    if (browserInstance?.isConnected())
        return browserInstance;
    if (browserPromise)
        return browserPromise;
    browserPromise = chromium
        .launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
            "--disable-extensions",
            "--renderer-process-limit=1",
            "--disk-cache-size=1",
            "--media-cache-size=1",
        ],
    })
        .then((browser) => {
        browserInstance = browser;
        browserPromise = null;
        browser.on("disconnected", () => {
            browserInstance = null;
        });
        return browser;
    })
        .catch((err) => {
        browserPromise = null;
        throw err;
    });
    return browserPromise;
}
export async function closeBrowser() {
    if (browserInstance?.isConnected()) {
        await browserInstance.close();
        browserInstance = null;
    }
}
//# sourceMappingURL=browser.js.map