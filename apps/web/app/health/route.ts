export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await fetch(
      `${process.env.API_INTERNAL_URL || "http://127.0.0.1:4000"}/health`,
      { cache: "no-store", signal: AbortSignal.timeout(3000) },
    );
    return Response.json(
      { status: result.ok ? "ok" : "unavailable" },
      { status: result.ok ? 200 : 503 },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
