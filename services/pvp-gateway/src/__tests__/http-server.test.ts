/** @jest-environment node */

type MinimalIncomingMessage = {
  headers: Record<string, string | undefined>;
  socket: {
    remoteAddress?: string;
    encrypted?: boolean;
  };
};

describe("http-server localhost transport checks", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function buildRequest(overrides?: Partial<MinimalIncomingMessage>): MinimalIncomingMessage {
    return {
      headers: {
        host: "localhost:8787",
        origin: "http://localhost:3000",
        ...(overrides?.headers ?? {}),
      },
      socket: {
        remoteAddress: "192.168.1.20",
        encrypted: false,
        ...(overrides?.socket ?? {}),
      },
    };
  }

  it("allows localhost websocket requests in production when insecure localhost is enabled", async () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PVP_INSECURE_LOCALHOST: "1",
      PVP_ALLOWED_ORIGINS: "http://localhost:3000",
    });

    const { isSecureGatewayRequest } = await import("../presentation/http-server");

    expect(isSecureGatewayRequest(buildRequest() as never)).toBe(true);
  });

  it("rejects non-local websocket requests in production insecure localhost mode", async () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PVP_INSECURE_LOCALHOST: "1",
      PVP_ALLOWED_ORIGINS: "http://localhost:3000",
    });

    const { isSecureGatewayRequest } = await import("../presentation/http-server");

    expect(
      isSecureGatewayRequest(
        buildRequest({
          headers: {
            host: "gateway.example.com",
            origin: "https://example.com",
          },
        }) as never,
      ),
    ).toBe(false);
  });
});
