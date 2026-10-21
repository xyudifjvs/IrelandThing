import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} style={{ padding: "12vh 8vw" }}>
      <p>WEATHERLY TRANSACTION CO.</p>
      <h1>This page is not here.</h1>
      <p>
        The address may have changed, or the page may no longer be available.
      </p>
      <Link href="/">Return to Weatherly</Link>
    </main>
  );
}
