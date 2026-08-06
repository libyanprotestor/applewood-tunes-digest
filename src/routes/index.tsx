import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Disc3, Globe2, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Apple Music Sales & Royalty Dashboard" },
      {
        name: "description",
        content:
          "Automated daily Apple Music sales reporting: catalog matching, USD conversion and per-sublabel revenue analytics.",
      },
      { property: "og:title", content: "Apple Music Sales & Royalty Dashboard" },
      {
        property: "og:description",
        content:
          "Automated daily Apple Music sales reporting with per-sublabel revenue analytics in USD.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Globe2,
    title: "Fetched on Apple's clock",
    body: "Three daily jobs aligned to Apple's 5am Pacific, Japan and Central European release windows, with automatic retries.",
  },
  {
    icon: Disc3,
    title: "Matched to your catalog",
    body: "Report lines are matched by ISRC or UPC to ringtones, singles and albums; anything unknown waits in a review queue.",
  },
  {
    icon: BarChart3,
    title: "Revenue in USD",
    body: "Every territory is converted using the report date's exchange rate, so daily, weekly, monthly and yearly totals stay stable.",
  },
  {
    icon: ShieldCheck,
    title: "Per-sublabel access",
    body: "Each sublabel signs in with credentials you issue and sees only their own units and revenue.",
  },
];

function Landing() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
          Label reporting
        </p>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Apple Music sales, matched, converted and split by sublabel.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Daily Apple reports land automatically, get matched to your catalog and turn into clean USD
          revenue for the whole company — and for every sublabel individually.
        </p>
        <div className="mt-10">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
          {features.map((feature) => (
            <div key={feature.title} className="bg-card p-8">
              <feature.icon className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="mt-4 text-base font-semibold">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
