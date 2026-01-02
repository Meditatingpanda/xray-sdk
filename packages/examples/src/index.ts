
import { XRay } from "@xray-sys/sdk";

type Product = { asin: string; title: string; price: number; rating: number; reviews: number };

const xray = new XRay({ endpoint: "http://localhost:4319" });

async function generateKeywords(title: string): Promise<string[]> {
    // pretend LLM
    return ["laptop stand", "portable stand", "aluminum stand"];
}

async function searchCatalog(_keywords: string[]): Promise<Product[]> {
    // pretend search with lots of results
    const items: Product[] = [];
    for (let i = 0; i < 5000; i++) {
        items.push({
            asin: `ASIN_${i}`,
            title: i % 120 === 0 ? "Phone case silicone" : `Laptop stand ${i}`,
            price: i % 7 === 0 ? 9.99 : 29.99,
            rating: 3.5 + (i % 15) / 10,
            reviews: i % 300
        });
    }
    return items;
}

function filterCandidates(cands: Product[]) {
    const out: Product[] = [];
    for (const c of cands) {
        const ok =
            c.price >= 15 &&
            c.price <= 80 &&
            c.rating >= 4.0 &&
            c.reviews >= 20;
        if (ok) out.push(c);
    }
    return out;
}

function rank(cands: Product[]): Product[] {
    return [...cands].sort((a, b) => (b.rating * Math.log(1 + b.reviews)) - (a.rating * Math.log(1 + a.reviews)));
}

async function main() {
    const run = xray.startRun({
        traceId: `req_${Date.now()}`,
        pipeline: "competitor_discovery",
        pipelineVersion: "1.0.0",
        input: { sellerAsin: "SELLER_123", title: "Laptop stand for desk" },
        tags: { env: "local", team: "pricing" }
    });

    await run.withContext(async () => {
        // Step 1: keywords (LLM)
        const s1 = run.step({
            name: "generate_keywords",
            type: "llm",
            input: { title: "Laptop stand for desk" },
            capturePolicy: { mode: "SUMMARY_ONLY" }
        });
        const keywords = await generateKeywords("Laptop stand for desk");
        s1.setOutput({ keywords });
        s1.setReasoning({ model: "mock-llm", notes: "title expanded into search intents" });
        await s1.endSuccess();

        // Step 2: search (big candidate set) — capture TOP 50
        const s2 = run.step({
            name: "search_catalog",
            type: "api_call",
            input: { keywords },
            capturePolicy: { mode: "TOP_K", topK: 50, includeOutcomes: false }
        });
        const raw = await searchCatalog(keywords);

        s2.addCandidates(
            raw.map((p, idx) => ({
                candidateId: p.asin,
                candidateType: "product",
                rank: idx + 1,
                payload: { title: p.title, price: p.price, rating: p.rating, reviews: p.reviews }
            }))
        );
        s2.setOutput({ total: raw.length });
        await s2.endSuccess();

        // Step 3: filter — store rejection reasons for captured items + histogram for all
        const s3 = run.step({
            name: "filter_candidates",
            type: "filter",
            input: { priceMin: 15, priceMax: 80, minRating: 4.0, minReviews: 20 },
            capturePolicy: { mode: "TOP_K", topK: 50, includeOutcomes: true, includeRejected: true }
        });

        // add candidates BEFORE filtering so we can compute rejection_rate
        s3.addCandidates(
            raw.map((p, idx) => ({
                candidateId: p.asin,
                candidateType: "product",
                rank: idx + 1,
                payload: { title: p.title, price: p.price, rating: p.rating, reviews: p.reviews }
            }))
        );

        const filtered = filterCandidates(raw);

        // outcomes with reason codes (this is “how to store rejections”)
        for (const p of raw) {
            const reasons: string[] = [];
            if (p.price < 15) reasons.push("PRICE_TOO_LOW");
            if (p.price > 80) reasons.push("PRICE_TOO_HIGH");
            if (p.rating < 4.0) reasons.push("RATING_TOO_LOW");
            if (p.reviews < 20) reasons.push("REVIEWS_TOO_LOW");

            if (reasons.length) {
                s3.reject(p.asin, "product", reasons[0], { reasons }, `Rejected due to ${reasons.join(", ")}`);
            } else {
                s3.accept(p.asin, "product", "PASSED_FILTERS");
            }
        }

        s3.setOutput({ kept: filtered.length });
        await s3.endSuccess();

        // Step 4: rank + select
        const s4 = run.step({
            name: "rank_and_select",
            type: "select",
            input: { method: "rating_log_reviews" },
            capturePolicy: { mode: "TOP_K", topK: 50 }
        });

        const ranked = rank(filtered);
        const top = ranked[0];

        s4.addCandidates(
            ranked.slice(0, 200).map((p, idx) => ({
                candidateId: p.asin,
                candidateType: "product",
                rank: idx + 1,
                score: p.rating * Math.log(1 + p.reviews),
                payload: { title: p.title, price: p.price, rating: p.rating, reviews: p.reviews }
            }))
        );

        s4.select(top.asin, "product", "TOP_SCORE", { score: top.rating * Math.log(1 + top.reviews) });
        s4.setOutput({ selected: top });
        await s4.endSuccess();

        run.endSuccess({ competitorAsin: top.asin });
    });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
