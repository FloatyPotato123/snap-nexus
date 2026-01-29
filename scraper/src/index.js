
import { runDailyScrape } from "./handlers/scraper.js";

export default {
    async scheduled(event, env, ctx) {
        ctx.waitUntil(runDailyScrape(env));
    },
};
