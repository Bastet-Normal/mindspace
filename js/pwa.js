(function () {
    const canRegisterServiceWorker = "serviceWorker" in navigator
        && (window.location.protocol === "http:" || window.location.protocol === "https:");

    if (!canRegisterServiceWorker) return;

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((error) => {
            console.warn("MindSpace offline cache registration skipped:", error);
        });
    });
})();
