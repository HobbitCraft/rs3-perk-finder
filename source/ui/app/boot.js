"use client";
const LOCAL_ASSET_REVISION = "20260804-sort-hotfix-2";
function localAsset(path) {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}v=${LOCAL_ASSET_REVISION}`;
}
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-perk-finder-src="${src}"]`);
        if (existing?.dataset.loaded === "true") {
            resolve();
            return;
        }
        const script = existing ?? document.createElement("script");
        const timeout = window.setTimeout(() => {
            reject(new Error(`Timed out while loading ${src}. Reload the local app to retry.`));
        }, 15_000);
        script.src = src;
        script.async = false;
        script.dataset.perkFinderSrc = src;
        script.addEventListener("load", () => {
            window.clearTimeout(timeout);
            script.dataset.loaded = "true";
            resolve();
        }, { once: true });
        script.addEventListener("error", () => {
            window.clearTimeout(timeout);
            reject(new Error(`Could not load ${src}`));
        }, { once: true });
        if (!existing)
            document.head.appendChild(script);
    });
}
class LocalWikiUri {
    path;
    query;
    fragment;
    constructor(input) {
        const url = new URL(input || window.location.href, window.location.href);
        this.path = url.pathname;
        this.query = Object.fromEntries(url.searchParams.entries());
        this.fragment = url.hash.replace(/^#/, "");
    }
    getQueryString() {
        const params = new URLSearchParams();
        Object.entries(this.query || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                params.set(key, String(value));
            }
        });
        return params.toString();
    }
    toString() {
        const query = this.getQueryString();
        return `${window.location.origin}${this.path}${query ? `?${query}` : ""}${this.fragment ? `#${this.fragment}` : ""}`;
    }
}
function installPriceSnapshot(snapshot) {
    document.querySelector(".perkcalc-matcost")?.remove();
    const priceRoot = document.createElement("span");
    priceRoot.className = "perkcalc-matcost hidden";
    priceRoot.hidden = true;
    priceRoot.dataset.revision = String(snapshot.revision);
    Object.entries(snapshot.materials).forEach(([name, price]) => {
        const element = document.createElement("span");
        element.className = "perkcalc-matcost-mat";
        element.dataset.matName = name;
        element.dataset.matPrice = String(price);
        priceRoot.appendChild(element);
    });
    Object.entries(snapshot.gizmos).forEach(([name, price]) => {
        const element = document.createElement("span");
        element.className = "perkcalc-gizmocost";
        element.dataset.gizmo = name;
        element.dataset.gizmoPrice = String(price);
        priceRoot.appendChild(element);
    });
    document.body.appendChild(priceRoot);
}
function installTablesorterStub($) {
    if (typeof $.fn.tablesorter === "function")
        return;
    $.fn.tablesorter = function tablesorter(options) {
        this.each(function installSortState() {
            const state = {
                config: {
                    sortList: options?.sortList?.slice() ?? [{ 8: "asc" }],
                },
                sort() {
                    // The upstream gadget maintains its own stable live ordering. This
                    // hook satisfies its final-sort contract without reordering a table
                    // while rows are still streaming from multiple workers.
                    return undefined;
                },
            };
            window.jQuery(this).data("tablesorter", state);
        });
        return this;
    };
}
function installMediaWikiCompatibility() {
    const $ = window.jQuery;
    installTablesorterStub($);
    const escapeHtml = (value) => String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    const wiki = {
        Uri: LocalWikiUri,
        html: { escape: escapeHtml },
        loader: {
            load() { },
            using() {
                return Promise.resolve();
            },
        },
        notify(message) {
            const toast = document.getElementById("app-toast");
            if (!toast)
                return;
            toast.textContent = message;
            toast.classList.add("is-visible");
            window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
        },
        util: {
            getUrl(page) {
                return `https://runescape.wiki/w/${page.replaceAll(" ", "_")}`;
            },
        },
    };
    window.mediaWiki = wiki;
    window.mw = wiki;
    window.rswiki = {};
    window.PerkFinderConfig = {
        native: true, workerUrl: localAsset("/vendor/runescape/perkfinder-native-worker.js"),
        importUrls: { core: "/vendor/runescape/perkcalc-core.js" },
    };
}
async function bootPerkFinder() {
    const snapshotResponse = await fetch("/vendor/runescape/prices.json");
    if (!snapshotResponse.ok)
        throw new Error("Could not load the component price snapshot.");
    installPriceSnapshot((await snapshotResponse.json()));
    await loadScript("/vendor/jquery.min.js");
    await loadScript("/vendor/oojs.min.js");
    await loadScript("/vendor/oojs-ui/oojs-ui-core.min.js");
    await loadScript("/vendor/oojs-ui/oojs-ui-wikimediaui.min.js");
    await loadScript("/vendor/oojs-ui/oojs-ui-widgets.min.js");
    await loadScript("/vendor/oojs-ui/oojs-ui-windows.min.js");
    installMediaWikiCompatibility();
    await loadScript("/vendor/runescape/perkcalc-data.js");
    await loadScript(localAsset("/vendor/runescape/perkfinder-core.js"));
}
const status = document.getElementById('boot-status');
bootPerkFinder().then(() => { status.className = 'turbo-status turbo-status--ready'; status.textContent = 'Native Rust engine · exhaustive search'; }).catch(error => { status.className = 'turbo-status turbo-status--error'; status.textContent = error.message; });
const session = new EventSource('/__session');
session.onerror = () => { status.textContent = 'Connection interrupted. If it does not recover, open Perk Finder.exe again.'; };
const notices = document.createElement('a');
notices.href = '/THIRD-PARTY-NOTICES.txt';
notices.target = '_blank';
notices.rel = 'noopener';
notices.textContent = 'Third-party licences and attribution';
document.querySelector('.app-footer')?.append(document.createElement('br'), notices);
