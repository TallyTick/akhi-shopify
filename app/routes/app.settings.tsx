import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { authenticate } from "../shopify.server";
import { EngineRequestError, postToEngine } from "../engine.server";

type JsonRecord = Record<string, unknown>;

interface ReplyTemplate {
  key: string;
  title: string;
  wording: string;
  placeholders: string[];
}

interface SettingsData {
  registered: boolean;
  handoffEmail: string;
  replyTemplates: ReplyTemplate[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getWording(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return "";

  for (const key of [
    "currentWording",
    "wording",
    "text",
    "content",
    "template",
    "value",
  ]) {
    if (typeof value[key] === "string") return value[key];
  }
  return "";
}

function getPlaceholders(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function normalizeSettings(data: unknown): SettingsData {
  const response = isRecord(data) ? data : {};
  const settings = isRecord(response.settings) ? response.settings : response;
  const templatesValue = settings.replyTemplates ?? settings.templates;
  const placeholdersValue = settings.allowedPlaceholders;
  const templates: ReplyTemplate[] = [];

  if (Array.isArray(templatesValue)) {
    for (const [index, template] of templatesValue.entries()) {
      if (!isRecord(template)) continue;
      const key =
        typeof template.key === "string"
          ? template.key
          : typeof template.id === "string"
            ? template.id
            : `template-${index}`;
      templates.push({
        key,
        title:
          typeof template.label === "string"
            ? template.label
            : typeof template.name === "string"
              ? template.name
              : key,
        wording: getWording(template),
        placeholders: getPlaceholders(
          template.allowedPlaceholders ?? template.placeholders,
        ),
      });
    }
  } else if (isRecord(templatesValue)) {
    for (const [key, template] of Object.entries(templatesValue)) {
      const placeholderList = isRecord(placeholdersValue)
        ? placeholdersValue[key]
        : placeholdersValue;
      templates.push({
        key,
        title: isRecord(template) && typeof template.label === "string"
          ? template.label
          : key,
        wording: getWording(template),
        placeholders: getPlaceholders(
          (isRecord(template) &&
            (template.allowedPlaceholders ?? template.placeholders)) ??
            placeholderList,
        ),
      });
    }
  }

  return {
    registered: true,
    handoffEmail:
      typeof settings.handoffEmail === "string" ? settings.handoffEmail : "",
    replyTemplates: templates,
  };
}

function validationErrors(data: unknown): Record<string, string> {
  if (!isRecord(data)) return {};
  const errorsValue = data.validationErrors ?? data.errors;
  if (isRecord(errorsValue)) {
    return Object.fromEntries(
      Object.entries(errorsValue).map(([field, value]) => [
        field,
        Array.isArray(value) ? value.join(", ") : String(value),
      ]),
    );
  }
  if (Array.isArray(errorsValue)) {
    return Object.fromEntries(
      errorsValue
        .filter(isRecord)
        .map((error, index) => [
          typeof error.field === "string" ? error.field : `form-${index}`,
          typeof error.message === "string"
            ? error.message
            : "This value is invalid.",
        ]),
    );
  }
  return {};
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const data = await postToEngine<unknown>("/internal/shopify/settings/get", {
      shop: session.shop,
    });
    return normalizeSettings(data);
  } catch (error) {
    if (error instanceof EngineRequestError && error.statusCode === 404) {
      return { registered: false, handoffEmail: "", replyTemplates: [] };
    }
    throw error;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const handoffEmail = String(formData.get("handoffEmail") ?? "");
  const replyTemplates: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (name.startsWith("replyTemplate:") && typeof value === "string") {
      replyTemplates[decodeURIComponent(name.slice("replyTemplate:".length))] =
        value;
    }
  }

  const submitted = { handoffEmail, replyTemplates };
  try {
    const result = await postToEngine<unknown>(
      "/internal/shopify/settings/update",
      { shop: session.shop, ...submitted },
    );
    const errors = validationErrors(result);
    if (Object.keys(errors).length > 0) {
      return { ...submitted, errors, saved: false };
    }
    return { ...submitted, errors: {}, saved: true };
  } catch (error) {
    if (error instanceof EngineRequestError && error.statusCode === 404) {
      return { ...submitted, registered: false };
    }
    if (!(error instanceof EngineRequestError)) {
      throw error;
    }

    const errors = validationErrors(error.responseData);
    return {
      ...submitted,
      errors:
        Object.keys(errors).length > 0
          ? errors
          : { form: "Unable to save settings. Please try again." },
    };
  }
};

export default function SettingsPage() {
  const settings = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const saving = navigation.state === "submitting";
  const notRegistered =
    actionData &&
    "registered" in actionData &&
    actionData.registered === false;
  const handoffEmail =
    actionData && "handoffEmail" in actionData
      ? actionData.handoffEmail
      : settings.handoffEmail;
  const templateValues =
    actionData && "replyTemplates" in actionData
      ? actionData.replyTemplates
      : {};
  const errors =
    actionData && "errors" in actionData ? actionData.errors : {};
  const saved =
    actionData && "saved" in actionData && actionData.saved === true;

  if (!settings.registered || notRegistered) {
    return (
      <s-page heading="Settings">
        <s-section heading="Store setup in progress">
          <s-paragraph>
            Your store is not registered with the service yet. Try again in a
            moment.
          </s-paragraph>
          <s-button
            onClick={() => void revalidator.revalidate()}
            {...(revalidator.state === "loading" ? { loading: true } : {})}
          >
            Retry
          </s-button>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Settings">
      <Form method="post">
        <s-section heading="Merchant settings">
          {saved && (
            <s-banner tone="success" heading="Saved">
              Your settings have been saved.
            </s-banner>
          )}
          {errors.form && (
            <s-banner tone="critical" heading="Unable to save settings">
              {errors.form}
            </s-banner>
          )}
          <s-text-field
            label="Handoff email"
            name="handoffEmail"
            value={handoffEmail}
          />
          {errors.handoffEmail && (
            <s-paragraph tone="critical">{errors.handoffEmail}</s-paragraph>
          )}
          {settings.replyTemplates.map((template) => (
            <s-stack key={template.key} direction="block" gap="small">
              <s-text-area
                label={template.title}
                name={`replyTemplate:${encodeURIComponent(template.key)}`}
                value={templateValues[template.key] ?? template.wording}
                rows={5}
              />
              {(errors[`replyTemplates.${template.key}`] ??
                errors[template.key]) && (
                <s-paragraph tone="critical">
                  {errors[`replyTemplates.${template.key}`] ??
                    errors[template.key]}
                </s-paragraph>
              )}
              <s-paragraph>
                Allowed placeholders:{" "}
                {template.placeholders.length > 0
                  ? template.placeholders.join(", ")
                  : "Use only placeholders supported for this template."}
              </s-paragraph>
            </s-stack>
          ))}
          {settings.replyTemplates.length === 0 && (
            <s-paragraph>No reply templates are configured yet.</s-paragraph>
          )}
          <s-button
            type="submit"
            variant="primary"
            {...(saving ? { loading: true } : {})}
          >
            Save settings
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
