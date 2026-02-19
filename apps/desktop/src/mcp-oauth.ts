import { invoke } from "@tauri-apps/api/core";
import type {
  OAuthClientProvider,
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
} from "@ai-sdk/mcp";

// IPC commands prepend "api_key:" internally, so omit that prefix here.
function vaultKey(serverId: string, dataType: string): string {
  return `mcp:${serverId}:${dataType}`;
}

async function loadVaultJson<T>(
  serverId: string,
  dataType: string
): Promise<T | undefined> {
  const raw = await invoke<string | null>("get_api_key", {
    provider: vaultKey(serverId, dataType),
  });
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as T;
}

async function saveVaultJson(
  serverId: string,
  dataType: string,
  data: unknown
): Promise<void> {
  await invoke("store_api_key", {
    provider: vaultKey(serverId, dataType),
    apiKey: JSON.stringify(data),
  });
}

async function loadVaultString(
  serverId: string,
  dataType: string
): Promise<string | undefined> {
  const raw = await invoke<string | null>("get_api_key", {
    provider: vaultKey(serverId, dataType),
  });
  return raw ?? undefined;
}

async function saveVaultString(
  serverId: string,
  dataType: string,
  value: string
): Promise<void> {
  await invoke("store_api_key", {
    provider: vaultKey(serverId, dataType),
    apiKey: value,
  });
}

export type NosisOAuthProvider = OAuthClientProvider & {
  updateRedirectUrl(url: string): void;
};

export function createNosisOAuthProvider(serverId: string): NosisOAuthProvider {
  const state = { redirectUrl: "http://localhost/oauth/callback" };

  return {
    get redirectUrl(): string {
      return state.redirectUrl;
    },

    updateRedirectUrl(url: string) {
      state.redirectUrl = url;
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: "Nosis",
        redirect_uris: [state.redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    },

    clientInformation(): Promise<OAuthClientInformation | undefined> {
      return loadVaultJson<OAuthClientInformation>(serverId, "client_info");
    },

    async saveClientInformation(info: OAuthClientInformation): Promise<void> {
      await saveVaultJson(serverId, "client_info", info);
    },

    tokens(): Promise<OAuthTokens | undefined> {
      return loadVaultJson<OAuthTokens>(serverId, "tokens");
    },

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      await saveVaultJson(serverId, "tokens", tokens);
    },

    redirectToAuthorization(authorizationUrl: URL): void {
      const popup = window.open(authorizationUrl.toString(), "_blank");
      if (!popup) {
        throw new Error(
          "Failed to open OAuth authorization window — popup may be blocked"
        );
      }
    },

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
      await saveVaultString(serverId, "code_verifier", codeVerifier);
    },

    async codeVerifier(): Promise<string> {
      const verifier = await loadVaultString(serverId, "code_verifier");
      if (!verifier) {
        throw new Error("No PKCE code verifier found");
      }
      return verifier;
    },
  };
}
