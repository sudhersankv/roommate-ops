import type { MetadataRoute } from "next";

// Only the landing page is for crawlers. Dashboards, Claim links, the API and operator pages are private.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/g/", "/claim/", "/auth/", "/api/", "/admin/"] }],
  };
}
