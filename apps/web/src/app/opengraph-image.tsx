import { ImageResponse } from "next/og";

export const alt =
  "App Store Connect MCP. Let your AI agent work in App Store Connect. Builds, customer reviews, TestFlight, and version metadata.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: "#fff",
          color: "#171717",
          fontFamily: "Geist",
          fontWeight: 400,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 30 }}>
          <svg width="64" height="64" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#171717" />
            <path
              fill="#fff"
              fillRule="evenodd"
              d="M27 16h10l13 32h-8l-3-8H25l-3 8h-8L27 16Zm.625 17h8.75L32 21.8 27.625 33Z"
            />
          </svg>
          App Store Connect MCP
        </div>
        <div style={{ fontSize: 78, lineHeight: 1.05, letterSpacing: -3, maxWidth: 940 }}>
          Let your AI agent work in App Store Connect.
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {["Builds", "Customer reviews", "TestFlight", "Version metadata"].map((label) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  border: "1px solid #e5e5e5",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 20,
                }}
              >
                {label}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 24, color: "#737373" }}>ascmcp.dev</div>
        </div>
      </div>
    ),
    size,
  );
}
