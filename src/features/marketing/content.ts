/**
 * Every visible string on the page lives here so copy can be changed without
 * touching layout or motion code.
 */

export const site = {
  name: "Adcrevia",
  domain: "adcrevia.com",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://adcrevia.com",
  /**
   * Static export, so a computed year would freeze at build time and quietly
   * go stale. Kept explicit instead.
   */
  copyrightYear: 2026,
  tagline: "Turn your products into social videos.",
  description:
    "Adcrevia turns your products into social media videos. Add your products, review what gets made, publish to the platforms you choose, and learn what works. Join the waitlist for early access.",
  contactEmail: "hello@adcrevia.com",
  launchWindow: "December 2026",
  founder: {
    name: "Nambi Rajan",
    role: "Founder, Adcrevia",
    initials: "NR",
  },
  builtBy: {
    name: "RootPro Technologies",
    url: "https://rootpro.in",
  },
} as const;

export const nav = {
  links: [
    { label: "How it works", id: "workflow" },
    { label: "Automation", id: "automation" },
    { label: "Who it's for", id: "audience" },
  ],
  cta: { label: "Join the waitlist", id: "waitlist" },
  /**
   * The landing page is a pre-launch waitlist, but it is also the front door of a
   * working product: people already invited need a way in that is not "scroll
   * to the form they have already filled in".
   */
  signIn: { label: "Sign in", href: "/login" },
} as const;

export const hero = {
  eyebrow: "Early access",
  headlineLead: "Turn your products into",
  headlineAccent: "social videos.",
  sub: "Add your products. Adcrevia plans the videos, you approve them, then publish to the platforms you choose.",
  secondaryCta: "See the workflow",
} as const;

export const platforms = {
  label: "At launch, publishing to",
  items: [
    { name: "YouTube Shorts", slug: "youtube" },
    { name: "Instagram Reels", slug: "instagram" },
    { name: "Facebook", slug: "facebook" },
    { name: "TikTok", slug: "tiktok" },
  ],
} as const;

export const thesis = {
  statement:
    "You already have the products, the photos, the catalogs. What you do not have is the time to turn them into video, week after week.",
  support:
    "Adcrevia is being built to close that gap without taking the decisions out of your hands.",
} as const;

export const workflow = {
  eyebrow: "How it works",
  heading: "Seven steps, start to finish.",
  sub: "One path through the product. What changes is how much of it you want to run yourself.",
  steps: [
    {
      title: "Create a project",
      body: "Group a brand, a store, or a campaign in one place. Add products from a website link, a catalog, a flyer, or by hand.",
      control: "You choose how much runs on its own",
      image: "/images/workflow-create.jpg",
      alt: "Assorted small retail products arranged in a flat lay",
    },
    {
      title: "Plan the run",
      body: "Products get checked for missing information, then ordered into a production queue. Reorder it, skip products, or override the order entirely.",
      control: "You confirm before anything is made",
      image: "/images/workflow-plan.jpg",
      alt: "A hand pinning printed screens into a connected sequence on a wall",
    },
    {
      title: "Produce",
      body: "Visuals, script, voice, music, captions, and the final cut are assembled into finished videos, in the number of variations you asked for.",
      control: "You set the variations and the cost ceiling",
      image: "/images/workflow-produce.jpg",
      alt: "A video editing timeline with video and audio tracks on screen",
    },
    {
      title: "Review",
      body: "Watch what came out. Approve it, reject it, or send it back for another pass with a note about what was wrong.",
      control: "Nothing leaves without a pass",
      image: "/images/workflow-review.jpg",
      alt: "Two people marking up a printed plan at a desk with pencils",
    },
    {
      title: "Distribute",
      body: "Pick the connected accounts and the platforms for each video. Publish now, or put it on the calendar and walk away.",
      control: "You pick every destination",
      image: "/images/workflow-distribute.jpg",
      alt: "A phone on a desk showing a feed of posts",
    },
    {
      title: "Measure",
      body: "Performance from every published video lands in one place, so you are not opening four apps to find out what happened.",
      control: "One view across platforms",
      image: "/images/workflow-measure.jpg",
      alt: "A performance dashboard with charts open on a laptop",
    },
    {
      title: "Learn",
      body: "What worked, what did not, and what to change next time. Every lesson is a suggestion you can accept or ignore.",
      control: "You choose what carries forward",
      image: "/images/workflow-learn.jpg",
      alt: "A quiet desk with a page layout on screen and a notebook alongside",
    },
  ],
} as const;

export const automation = {
  heading: "You decide how much of it runs without you.",
  sub: "Set every decision one of three ways. Change it per project, or for a single video when one needs a closer look.",
  modes: [
    { id: "auto", label: "On its own" },
    { id: "ask", label: "Ask first" },
    { id: "manual", label: "You do it" },
  ],
  decisions: [
    { id: "produce", label: "Generating videos" },
    { id: "review", label: "Approving what goes out" },
    { id: "publish", label: "Publishing and scheduling" },
    { id: "learn", label: "Applying what it learns" },
  ],
  summaries: {
    full: {
      title: "Fully automated",
      body: "Adcrevia takes every step. You watch the results come in and step in when you want to.",
    },
    partial: {
      title: "Partially automated",
      body: "The heavy work runs on its own. The calls you care about still come to you first.",
    },
    manual: {
      title: "Manual control",
      body: "Nothing moves until you say so. Adcrevia prepares the work and waits.",
    },
  },
} as const;

export const audience = {
  heading: "Built for people who have products, not production teams.",
  items: [
    {
      title: "Online stores",
      body: "A catalog full of products and nowhere near enough video to go with it.",
      image: "/images/audience-stores.jpg",
      alt: "A stocked retail shop interior with clothing rails and shelves",
    },
    {
      title: "Small businesses and local shops",
      body: "A website, a folder of photos, a PDF catalog. That is enough to start.",
    },
    {
      title: "Creators and marketers",
      body: "Several angles on the same product without rebuilding the edit every time.",
    },
    {
      title: "Agencies",
      body: "One project per client, per brand, or per campaign, kept properly apart from each other.",
      image: "/images/audience-agencies.jpg",
      alt: "Two colleagues working through something on a laptop in a shared office",
    },
  ],
} as const;

export const loop = {
  heading: "It does not end at publish.",
  sub: "Every published video tells the next one what to do differently.",
  nodes: ["Create", "Review", "Distribute", "Measure", "Learn", "Improve"],
} as const;

export const waitlist = {
  eyebrow: "Waitlist",
  heading: "Join the waitlist",
  sub: `We are building through the rest of the year. Invitations go out in batches from ${site.launchWindow}, starting with the people who tell us what they sell.`,
  privacy:
    "We use this to plan the rollout and to email you when your batch opens. Nothing else, and no reselling.",
  submit: "Join the waitlist",
  submitting: "Sending",
  successTitle: "You are on the list.",
  successBody: (email: string) =>
    `We will email ${email} when your batch opens. If you sell something unusual, expect us to ask about it.`,
  errorTitle: "That did not go through.",
  errorBody: "Check the fields below and try again.",
  networkError:
    "We could not reach the server. Check your connection and try again.",
  businessTypes: [
    "Online store",
    "Local business or shop",
    "Creator or marketer",
    "Agency",
    "Something else",
  ],
  sources: [
    "Google",
    "YouTube",
    "Instagram",
    "Facebook",
    "TikTok",
    "LinkedIn",
    "Email",
    "An advertisement",
    "A friend or colleague",
    "A blog or article",
    "Other",
  ],
} as const;

export const founder = {
  note: [
    "I have watched sellers with genuinely good products lose to businesses that simply post more. Not better. More.",
    "Adcrevia is the tool I wanted for them. It should do the heavy part of making product videos, and it should still ask before it does anything that actually matters.",
  ],
} as const;

export const footer = {
  blurb: "Turning products into social videos. In build, opening in batches.",
  columns: [
    {
      title: "The product",
      links: [
        { label: "How it works", id: "workflow" },
        { label: "Automation", id: "automation" },
        { label: "Who it's for", id: "audience" },
        { label: "Join the waitlist", id: "waitlist" },
      ],
    },
  ],
} as const;
