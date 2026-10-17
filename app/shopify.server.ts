import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { EngineRequestError, postToEngine } from "./engine.server";
import { BillingInterval } from "@shopify/shopify-app-react-router/server";
import {
  PLAN_AMOUNT,
  PLAN_CURRENCY,
  PLAN_NAME,
  TRIAL_DAYS,
} from "./billing.config";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [PLAN_NAME]: {
      lineItems: [
        {
          amount: PLAN_AMOUNT,
          currencyCode: PLAN_CURRENCY,
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: TRIAL_DAYS,
    },
  },
  hooks: {
    afterAuth: async ({ session }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await postToEngine("/internal/shopify/installations", {
            shop: session.shop,
          });
          return;
        } catch (error) {
          if (attempt === 2) {
            const code =
              error instanceof EngineRequestError
                ? error.code
                : "unknown_error";
            console.error("Engine installation sync failed", {
              shop: session.shop,
              code,
            });
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
