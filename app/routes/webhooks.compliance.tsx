import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { EngineRequestError, postToEngine } from "../engine.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customer =
    payload.customer && typeof payload.customer === "object"
      ? (payload.customer as Record<string, unknown>)
      : {};
  const phone = typeof customer.phone === "string" ? customer.phone : null;
  const email = typeof customer.email === "string" ? customer.email : null;

  let endpoint: string | undefined;
  let body: Record<string, unknown> = { shop };
  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      endpoint = "/internal/shopify/customer-data";
      body = { shop, phone, email };
      break;
    case "CUSTOMERS_REDACT":
      endpoint = "/internal/shopify/redact-customer";
      body = { shop, phone, email };
      break;
    case "SHOP_REDACT":
      endpoint = "/internal/shopify/redact-shop";
      break;
  }

  if (endpoint) {
    try {
      await postToEngine(endpoint, body);
    } catch (error) {
      const code =
        error instanceof EngineRequestError ? error.code : "processing_error";
      console.error("Shopify compliance processing failed", {
        shop,
        topic,
        code,
      });
    }
  }

  if (topic === "SHOP_REDACT") {
    try {
      await db.session.deleteMany({ where: { shop } });
    } catch {
      console.error("Shopify compliance database cleanup failed", {
        shop,
        topic,
        code: "database_error",
      });
    }
  }

  return new Response();
};
