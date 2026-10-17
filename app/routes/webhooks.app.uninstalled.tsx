import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { EngineRequestError, postToEngine } from "../engine.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  try {
    await postToEngine("/internal/shopify/uninstalled", { shop });
  } catch (error) {
    const code =
      error instanceof EngineRequestError ? error.code : "unknown_error";
    console.error("Engine uninstall sync failed", { shop, code });
  }

  return new Response();
};
