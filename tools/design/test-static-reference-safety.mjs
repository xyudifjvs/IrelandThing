import assert from "node:assert/strict";
import {
  assertSafeStaticMarkup,
  assertLocalCss,
} from "./static-reference-safety.mjs";
const local = new Set(["/brand/site/safe.png", "/brand/site/safe.woff2"]);
assert.doesNotThrow(() =>
  assertSafeStaticMarkup(
    '<section><img src="/brand/site/safe.png"><a href="/services">Services</a><form><input type="email"><button type="submit">Save</button></form></section>',
    local,
  ),
);
for (const payload of [
  "<script>alert(1)</script>",
  '<iframe src="/brand/site/safe.png"></iframe>',
  "<object></object>",
  "<embed>",
  '<img src="/brand/site/safe.png" onerror="alert(1)">',
  '<a href="javascript&colon;alert(1)">x</a>',
  '<a href="java&#x09;script:alert(1)">x</a>',
  '<img src="https://evil.example/image.png">',
  '<img src="//evil.example/image.png">',
  '<img src="/brand/site/safe.png" srcset="https://evil.example/track.png 2x">',
  '<div style="background:url(https://evil.example/a)">x</div>',
  '<div style="background:u\\72l(https://evil.example/a)">x</div>',
  '<form action="https://evil.example"></form>',
])
  assert.throws(() => assertSafeStaticMarkup(payload, local), payload);
assert.throws(() =>
  assertLocalCss('@import "https://evil.example/style.css";', local),
);
assert.doesNotThrow(() =>
  assertLocalCss('@font-face{src:url("/brand/site/safe.woff2")}', local),
);
console.log(
  "Static reference safety checks pass (safe markup plus 15 blocked injection/resource cases).",
);
