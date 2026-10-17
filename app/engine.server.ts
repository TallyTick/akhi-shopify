const ENGINE_TIMEOUT_MS = 10_000;

export class EngineRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly responseData?: unknown,
  ) {
    super(code);
    this.name = "EngineRequestError";
  }
}

export async function postToEngine<T = void>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const engineUrl = process.env.ENGINE_URL;
  const secret = process.env.INTERNAL_API_SECRET;

  if (!engineUrl || !secret) {
    throw new EngineRequestError("engine_config_missing");
  }

  let response: Response;
  try {
    response = await fetch(
      `${engineUrl.replace(/\/+$/, "")}${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EngineRequestError(isTimeout ? "timeout" : "network_error");
  }

  const responseText = await response.text();
  let responseData: unknown;
  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = undefined;
    }
  }

  if (!response.ok) {
    throw new EngineRequestError(
      `http_${response.status}`,
      response.status,
      responseData,
    );
  }

  return responseData as T;
}
