import { ImageResponse } from "next/og";

const size = { width: 1200, height: 630 };
export function socialImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: "#f5f0e8",
        color: "#69533b",
        padding: "90px",
        border: "24px solid #e8deca",
      }}
    >
      <div style={{ fontSize: 68, letterSpacing: 8 }}>WEATHERLY</div>
      <div style={{ fontSize: 22, letterSpacing: 6, marginTop: 14 }}>
        TRANSACTION CO.
      </div>
      <div style={{ fontSize: 34, marginTop: 80, maxWidth: 900 }}>
        Real estate transaction coordination with Ireland.
      </div>
    </div>,
    size,
  );
}
