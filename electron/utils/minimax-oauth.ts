import { createHash, randomBytes, randomUUID } from "node:crypto";

export type MiniMaxRegion = "cn" | "global";

const MINIMAX_OAUTH_CONFIG = {
    cn: {
        baseUrl: "https://api.minimaxi.com",
        clientId: "78257093-7e40-4613-99e0-527b14b39113",
    },
    global: {
        baseUrl: "https://api.minimax.io",
        clientId: "78257093-7e40-4613-99e0-527b14b39113",
    },
} as const;

const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";

function getOAuthEndpoints(region: MiniMaxRegion) {
    const config = MINIMAX_OAUTH_CONFIG[region];
    return {
        codeEndpoint: `${config.baseUrl}/oauth/code`,
        tokenEndpoint: `${config.baseUrl}/oauth/token`,
        clientId: config.clientId,
        baseUrl: config.baseUrl,
    };
}

export type MiniMaxOAuthAuthorization = {
    user_code: string;
    verification_uri: string;
    expired_in: number;
    interval?: number;
    state: string;
};

export type MiniMaxOAuthToken = {
    access: string;
    refresh: string;
    expires: number;
    resourceUrl?: string;
    notification_message?: string;
};

type TokenPending = { status: "pending"; message?: string };

type TokenResult =
    | { status: "success"; token: MiniMaxOAuthToken }
    | TokenPending
    | { status: "error"; message: string };

function toFormUrlEncoded(data: Record<string, string>): string {
    return Object.entries(data)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&");
}

function generatePkce(): { verifier: string; challenge: string; state: string } {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(16).toString("base64url");
    return { verifier, challenge, state };
}

export async function requestMiniMaxOAuthCode(region: MiniMaxRegion = "global"): Promise<{ oauth: MiniMaxOAuthAuthorization, verifier: string, region: MiniMaxRegion }> {
    const { verifier, challenge, state } = generatePkce();
    const endpoints = getOAuthEndpoints(region);

    const response = await fetch(endpoints.codeEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "x-request-id": randomUUID(),
        },
        body: toFormUrlEncoded({
            response_type: "code",
            client_id: endpoints.clientId,
            scope: MINIMAX_OAUTH_SCOPE,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state: state,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`MiniMax OAuth authorization failed: ${text || response.statusText}`);
    }

    const payload = (await response.json()) as MiniMaxOAuthAuthorization & { error?: string };
    if (!payload.user_code || !payload.verification_uri) {
        throw new Error(
            payload.error ??
            "MiniMax OAuth authorization returned an incomplete payload (missing user_code or verification_uri).",
        );
    }
    if (payload.state !== state) {
        throw new Error("MiniMax OAuth state mismatch: possible CSRF attack or session corruption.");
    }

    return { oauth: payload, verifier, region };
}

export async function pollMiniMaxOAuthToken(params: {
    userCode: string;
    verifier: string;
    region: MiniMaxRegion;
}): Promise<TokenResult> {
    const endpoints = getOAuthEndpoints(params.region);
    const response = await fetch(endpoints.tokenEndpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: toFormUrlEncoded({
            grant_type: MINIMAX_OAUTH_GRANT_TYPE,
            client_id: endpoints.clientId,
            user_code: params.userCode,
            code_verifier: params.verifier,
        }),
    });

    const text = await response.text();
    let payload:
        | {
            status?: string;
            base_resp?: { status_code?: number; status_msg?: string };
        }
        | undefined;
    if (text) {
        try {
            payload = JSON.parse(text) as typeof payload;
        } catch {
            payload = undefined;
        }
    }

    if (!response.ok) {
        return {
            status: "error",
            message:
                (payload?.base_resp?.status_msg ?? text) || "MiniMax OAuth failed to parse response.",
        };
    }

    if (!payload) {
        return { status: "error", message: "MiniMax OAuth failed to parse response." };
    }

    const tokenPayload = payload as {
        status: string;
        access_token?: string | null;
        refresh_token?: string | null;
        expired_in?: number | null;
        token_type?: string;
        resource_url?: string;
        notification_message?: string;
    };

    if (tokenPayload.status === "error") {
        return { status: "error", message: "An error occurred. Please try again later" };
    }

    if (tokenPayload.status != "success") {
        return { status: "pending", message: "current user code is not authorized" };
    }

    if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expired_in) {
        return { status: "error", message: "MiniMax OAuth returned incomplete token payload." };
    }

    return {
        status: "success",
        token: {
            access: tokenPayload.access_token,
            refresh: tokenPayload.refresh_token,
            expires: tokenPayload.expired_in,
            resourceUrl: tokenPayload.resource_url,
            notification_message: tokenPayload.notification_message,
        },
    };
}
