/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Prompt 532 — the approved guest-access email is kept as the ZIP's own
    // template.html/plain_text.txt (src/lib/email-templates/), read with fs
    // at send time so the shipped file stays byte-for-byte diffable against
    // the approved package instead of being retyped into a TS string.
    //
    // Next only bundles what it can statically see, and a runtime
    // readFileSync is invisible to that trace — without this the files are
    // absent from the serverless function and every send throws ENOENT in
    // production while working perfectly in dev. Tracing them in is the
    // documented mechanism for exactly this.
    outputFileTracingIncludes: {
      '/api/data-room/invite-by-email': ['./src/lib/email-templates/**'],
      '/api/data-room/guest-invite': ['./src/lib/email-templates/**'],
    },
  },
};

export default nextConfig;
