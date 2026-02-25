import { createHash, randomBytes, randomUUID } from "node:crypto";

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`;
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_OAUTH_SCOPE = "openid profile email model.completion";
const QWEN_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export type QwenDeviceAuthorization = {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
};

export type QwenOAuthToken = {
    access: string;
    refresh: string;
    expires: number;
    resourceUrl?: string;
};

type TokenPending = { status: "pending"; slowDown?: boolean };

type DeviceTokenResult =
    | { status: "success"; token: QwenOAuthToken }
    | TokenPending
    | { status: "error"; message: string };

function toFormUrlEncoded(data: Record<string, string>): string {
    return Object.entries(data)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
}

function generatePkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return { verifier, challenge };
}

export async function requestQwenDeviceCode(): Promise<{ device: QwenDeviceAuthorization, verifier: string }> {
    const { verifier, challenge } = generatePkce();

    const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "x-request-id": randomUUID(),
        },
        body: toFormUrlEncoded({
            client_id: QWEN_OAUTH_CLIENT_ID,
            scope: QWEN_OAUTH_SCOPE,
            code_challenge: challenge,
            code_challenge_method: "S256",
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Qwen device authorization failed: ${text || response.statusText}`);
    }

    const payload = (await response.json()) as QwenDeviceAuthorization & { error?: string };
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
        throw new Error(
            payload.error ??
            "Qwen device authorization returned an incomplete payload (missing user_code or verification_uri).",
        );
    }

    return { device: payload, verifier };
}

export async function pollQwenDeviceToken(params: {
    deviceCode: string;
    verifier: string;
}): Promise<DeviceTokenResult> {
    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: toFormUrlEncoded({
            grant_type: QWEN_OAUTH_GRANT_TYPE,
            client_id: QWEN_OAUTH_CLIENT_ID,
            device_code: params.deviceCode,
            code_verifier: params.verifier,
        }),
    });

    if (!response.ok) {
        let payload: { error?: string; error_description?: string } | undefined;
        try {
            payload = (await response.json()) as { error?: string; error_description?: string };
        } catch {
            const text = await response.text();
            return { status: "error", message: text || response.statusText };
        }

        if (payload?.error === "authorization_pending") {
            return { status: "pending" };
        }

        if (payload?.error === "slow_down") {
            return { status: "pending", slowDown: true };
        }

        return {
            status: "error",
            message: payload?.error_description || payload?.error || response.statusText,
        };
    }

    const tokenPayload = (await response.json()) as {
        access_token?: string | null;
        refresh_token?: string | null;
        expires_in?: number | null;
        token_type?: string;
        resource_url?: string;
    };

    if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expires_in) {
        return { status: "error", message: "Qwen OAuth returned incomplete token payload." };
    }

    return {
        status: "success",
        token: {
            access: tokenPayload.access_token,
            refresh: tokenPayload.refresh_token,
            expires: Date.now() + tokenPayload.expires_in * 1000,
            resourceUrl: tokenPayload.resource_url,
        },
    };
}
