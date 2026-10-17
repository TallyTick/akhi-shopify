import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { EngineRequestError, postToEngine } from "../engine.server";

interface ShopStatus {
  whatsappNumberLinked?: boolean;
  settings?: { whatsappNumberLinked?: boolean };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const status = await postToEngine<ShopStatus>(
      "/internal/shopify/settings/get",
      { shop: session.shop },
    );
    return {
      linked:
        status.whatsappNumberLinked ??
        status.settings?.whatsappNumberLinked ??
        false,
    };
  } catch (error) {
    if (error instanceof EngineRequestError && error.statusCode === 404) {
      return { linked: false };
    }
    throw error;
  }
};

export default function Index() {
  const { linked } = useLoaderData<typeof loader>();

  return (
    <s-page heading="WhatsApp status">
      <s-section heading="Your store connection">
        <s-paragraph>
          WhatsApp number: {linked ? "linked" : "not linked yet"}
        </s-paragraph>
        <Link to="/app/settings">
          <s-button variant="primary">Open settings</s-button>
        </Link>
      </s-section>
    </s-page>
  );
}
