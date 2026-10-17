import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { SessionNotFoundError } from "@shopify/shopify-app-react-router/server";

import { unauthenticated } from "../shopify.server";

const ORDER_QUERY = `#graphql
  query InternalOrderLookup($query: String!) {
    orders(first: 1, query: $query) {
      nodes {
        name
        email
        phone
        displayFulfillmentStatus
        displayFinancialStatus
        cancelledAt
        customer {
          email
          phone
        }
        shippingAddress {
          phone
        }
        fulfillments {
          trackingInfo {
            company
            number
            url
          }
        }
      }
    }
  }
`;

interface OrderLookupPayload {
  data?: {
    orders?: {
      nodes?: Array<{
        name: string;
        email: string | null;
        phone: string | null;
        displayFulfillmentStatus: string;
        displayFinancialStatus: string;
        cancelledAt: string | null;
        customer: {
          email: string | null;
          phone: string | null;
        } | null;
        shippingAddress: {
          phone: string | null;
        } | null;
        fulfillments: Array<{
          trackingInfo: Array<{
            company: string | null;
            number: string | null;
            url: string | null;
          }>;
        }>;
      }>;
    };
  };
  errors?: Array<unknown>;
}

function logResult(shop: string, resultCode: string) {
  console.info(`[internal.orders.lookup] shop=${shop} result=${resultCode}`);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const secret = process.env.INTERNAL_API_SECRET;
  const suppliedSecret = request.headers.get("x-internal-secret");

  if (!secret || secret.length < 32 || !suppliedSecret) {
    return new Response(null, { status: 401 });
  }

  const secretBuffer = Buffer.from(secret, "utf8");
  const suppliedSecretBuffer = Buffer.from(suppliedSecret, "utf8");
  if (
    secretBuffer.length !== suppliedSecretBuffer.length ||
    !timingSafeEqual(secretBuffer, suppliedSecretBuffer)
  ) {
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { shop, orderNumber } = payload as {
    shop?: unknown;
    orderNumber?: unknown;
  };
  const orderNumberString =
    typeof orderNumber === "string" || typeof orderNumber === "number"
      ? String(orderNumber)
      : "";

  if (
    typeof shop !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ||
    !/^\d{1,10}$/.test(orderNumberString)
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  let admin: Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      logResult(shop, "shop_not_installed");
      return Response.json(
        { found: false, reason: "shop_not_installed" },
        { status: 404 },
      );
    }
    throw error;
  }

  const response = await admin.graphql(ORDER_QUERY, {
    variables: { query: `name:#${orderNumberString}` },
  });
  const result = (await response.json()) as OrderLookupPayload;
  if (!response.ok || result.errors?.length) {
    throw new Error("Shopify Admin GraphQL order lookup failed");
  }

  const order = result.data?.orders?.nodes?.[0];
  if (!order) {
    logResult(shop, "order_not_found");
    return Response.json(
      { found: false, reason: "order_not_found" },
      { status: 200 },
    );
  }

  const phones = [
    order.phone,
    order.customer?.phone,
    order.shippingAddress?.phone,
  ]
    .map((phone) => phone?.trim())
    .filter((phone): phone is string => Boolean(phone));
  const trackingInfo = order.fulfillments
    .flatMap((fulfillment) => fulfillment.trackingInfo)
    .find((tracking) => tracking.company || tracking.number || tracking.url);

  logResult(shop, "found");
  return Response.json({
    found: true,
    orderNumber: order.name,
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    cancelled: Boolean(order.cancelledAt),
    trackingCompany: trackingInfo?.company ?? null,
    trackingNumber: trackingInfo?.number ?? null,
    trackingUrl: trackingInfo?.url ?? null,
    phones: [...new Set(phones)],
    email: order.email || order.customer?.email || null,
  });
}
